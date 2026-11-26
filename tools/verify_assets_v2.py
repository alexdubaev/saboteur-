"""Check the v2 raster package, painted tile geometry, or the Vite output."""

import argparse
import hashlib
import itertools
import json
import re
import sys
from collections import Counter
from io import BytesIO
from pathlib import Path, PurePosixPath
from zipfile import BadZipFile, ZipFile

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = "data/asset-manifest.json"
BOARD_MANIFEST_PATH = "data/board-art-v2.json"
BOARD_TILES_DIR = "assets/board/tiles"
BOARD_SOURCE_DIR = "board-art-v2-candidates"
ZIP_ROOT = "gold-traitors-project/"
CARD_SIZES = {"standard": (512, 768), "compact": (256, 384)}
OPPOSITE = dict(zip("NESW", "SWNE"))
IMAGE_SUFFIXES = {".webp", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".avif", ".ico"}
ARCHIVE_SUFFIXES = {".zip", ".tar", ".gz", ".7z", ".rar"}


def require(condition, detail):
    if not condition:
        raise ValueError(detail)


def read_json(path):
    return json.loads((ROOT / path).read_bytes())


def safe_path(path, directory, suffix):
    parsed = PurePosixPath(path)
    require(parsed.parts and parsed.parts[0] == directory and
            ".." not in parsed.parts and str(parsed) == path and
            "\\" not in path and ":" not in path and parsed.suffix == suffix,
            f"Unexpected asset path: {path}")
    return parsed


def raster(data, expected, label, file_format):
    with Image.open(BytesIO(data)) as image:
        image.load()
        require(image.format == file_format and image.size == expected,
                f"{label}: expected {file_format} {expected}, got {image.format} {image.size}")
        return image.convert("RGB")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_entries(manifest):
    cards = manifest["cards"]
    other = manifest["otherAssets"]
    require(manifest["schemaVersion"] == 3, "Expected raster manifest schemaVersion 3")
    require(len(cards) == 40 and len({card["id"] for card in cards}) == 40 and len(other) == 27,
            "Expected 40 unique card arts and 27 additional WebP")
    entries = list(other)
    for card in cards:
        require(card["embeddedText"] is False and card["sourceSize"] == [1024, 1536],
                f"{card['id']}: unexpected source size or embedded text metadata")
        entries.extend(card_variants(card))
    for entry in entries:
        safe_path(entry["path"], "assets", ".webp")
    require(len({entry["path"].casefold() for entry in entries}) == 107, "Expected 107 unique asset paths")
    return entries


def active_data():
    config = read_json("data/game-config.json")
    return read_json(config["cardCatalog"])["cards"], read_json(config["developmentRuleset"])["board"]


def card_variants(card):
    variants = card["variants"]
    require(Counter(variant["purpose"] for variant in variants) == Counter(CARD_SIZES.keys()),
            f"{card['id']}: expected one standard and one compact asset")
    for variant in variants:
        require((variant["width"], variant["height"]) == CARD_SIZES[variant["purpose"]],
                f"{variant['path']}: unexpected card size in manifest")
    return variants


def board_geometry(board):
    origin, goals = board["origin"], board["goalAssets"]
    result = [(origin["assetId"], origin["connections"], [0])]
    result.extend((asset_id, [board["publicGoalPorts"]], [0])
                  for asset_id in [goals["ore"], *goals["barrenOptions"]])
    return result


def board_tile_path(art_id, purpose):
    layout = BOARD_TILES_DIR if purpose == "standard" else f"{BOARD_TILES_DIR}/compact"
    return f"{layout}/{art_id}.webp"


def board_entries(manifest, board, source_dir=None):
    cards = manifest["cards"]
    require(manifest["schemaVersion"] == 1, "Expected board art manifest schemaVersion 1")
    require(Counter(card["id"] for card in cards) == Counter(art_id for art_id, _, _ in board_geometry(board)),
            "Expected one derivative for each active start and revealed goal art ID")
    entries = []
    for card in cards:
        art_id = card["id"]
        source = f"{art_id}.png"
        require(card["source"] == f"{BOARD_SOURCE_DIR}/{source}" and re.fullmatch(r"[a-f0-9]{64}", card["sourceSha256"]),
                f"{art_id}: unexpected source path or SHA-256")
        require(isinstance(card["status"], str) and card["status"].strip(), f"{art_id}: missing art status")
        if source_dir:
            data = (source_dir / source).read_bytes()
            require(sha256(data) == card["sourceSha256"], f"{source}: board source SHA-256 mismatch")
            raster(data, (1024, 1536), source, "PNG")
        for variant in card_variants(card):
            purpose = variant["purpose"]
            require(variant["path"] == board_tile_path(art_id, purpose),
                    f"{art_id} {purpose}: unexpected derivative path")
            entries.append(variant)
    return entries


def check_entry(entry):
    path = entry["path"]
    data = (ROOT / path).read_bytes()
    require(len(data) == entry["bytes"] and sha256(data) == entry["sha256"],
            f"{path}: byte count or SHA-256 differs from the manifest")
    return raster(data, (entry["width"], entry["height"]), path, "WEBP")


def card_budget(purpose):
    return (120 if purpose == "standard" else 45) * 1024


def check_package(manifest, entries, owner_zip, owner_preview):
    by_id = {card["id"]: card for card in manifest["cards"]}
    catalog, board = active_data()
    for card in catalog:
        require(by_id[card["id"]]["kind"] == card["kind"],
                f"{card['id']}: catalog kind differs from the manifest")
        assets = {variant["purpose"]: variant["path"] for variant in by_id[card["id"]]["variants"]}
        require(assets == {"standard": card["asset"], "compact": card["compactAsset"]},
                f"{card['id']}: catalog asset paths differ from the manifest")
    goals = board["goalAssets"]
    for art_id in [board["origin"]["assetId"], goals["hidden"], goals["ore"], *goals["barrenOptions"]]:
        require(art_id in by_id, f"Missing active board asset {art_id}")

    oversize = []
    for entry in entries:
        path = entry["path"]
        check_entry(entry)
        if "purpose" in entry:
            limit = card_budget(entry["purpose"])
            if entry["bytes"] > limit:
                oversize.append(f"{path} ({entry['bytes']} B, +{entry['bytes'] - limit} B)")
    if owner_zip:
        with ZipFile(owner_zip) as archive:
            archive_manifest = archive.read(ZIP_ROOT + MANIFEST_PATH)
            local_manifest = (ROOT / MANIFEST_PATH).read_bytes()
            require(local_manifest.replace(b"\r\n", b"\n") == archive_manifest.replace(b"\r\n", b"\n"),
                    "Local manifest differs from the owner archive")
            archive_webp = Counter(name for name in archive.namelist()
                                   if name.startswith(ZIP_ROOT + "assets/") and name.endswith(".webp"))
            require(archive_webp == Counter(ZIP_ROOT + entry["path"] for entry in entries),
                    "Owner ZIP runtime WebP inventory differs from the manifest")
            print(f"Owner manifest SHA-256 {sha256(archive_manifest)}")
            for entry in entries:
                path = entry["path"]
                require(archive.read(ZIP_ROOT + path) == (ROOT / path).read_bytes(),
                        f"{path}: local WebP differs from the owner archive")
            for card in manifest["cards"]:
                source = card["source"]
                safe_path(source, "art-source", ".png")
                data = archive.read(ZIP_ROOT + source)
                require(sha256(data) == card["sourceSha256"], f"{source}: source SHA-256 mismatch")
                raster(data, tuple(card["sourceSize"]), source, "PNG")
            if owner_preview:
                data = archive.read(ZIP_ROOT + "docs/previews/tunnels-16.jpg")
                require(data == owner_preview.read_bytes(), "External JPG differs from the archive preview")
        print(f"Owner ZIP SHA-256 {file_sha256(owner_zip)}")
        if owner_preview:
            print(f"Owner JPG SHA-256 {file_sha256(owner_preview)}")
    total = sum(entry["bytes"] for entry in entries)
    print(f"Package OK: {len(entries)} WebP, {total:,} B")
    print(f"Card art statuses: {dict(Counter(card['status'] for card in manifest['cards']))}")
    for note in oversize:
        print(f"Over target budget: {note}")
    return []


def warm_ground(image):
    # Same warm-ground classifier as the owner tunnel package. It is specific to this art.
    red, green, blue = image.split()
    warm = ImageChops.multiply(red.point(lambda v: 255 if v > 150 else 0),
                               green.point(lambda v: 255 if v > 100 else 0))
    warm = ImageChops.multiply(warm, ImageChops.subtract(green, blue).point(
        lambda v: 255 if v > 35 else 0))
    return ImageChops.multiply(warm, ImageChops.subtract(red, green).point(
        lambda v: 255 if v < 145 else 0))


def edges(image):
    width, height = image.size
    return {"N": image.crop((0, 0, width, 1)),
            "E": image.crop((width - 1, 0, width, height)),
            "S": image.crop((0, height - 1, width, height)),
            "W": image.crop((0, 0, 1, height))}


def verify_ports(mask, groups, port_width, label):
    ports = set().union(*groups)
    errors = []
    opening_widths = []
    for direction, edge in edges(mask).items():
        observed = [i for i, value in enumerate(edge.tobytes()) if value]
        center = (edge.width * edge.height) // 2
        lo, hi = center - port_width // 2, center + port_width // 2
        if direction in ports:
            # Each endpoint may drift by 2 px. The open interval must remain contiguous.
            if observed and abs(observed[0] - lo) <= 2 and abs(observed[-1] + 1 - hi) <= 2:
                width = observed[-1] + 1 - observed[0]
                if len(observed) == width:
                    opening_widths.append(width)
                    continue
            span = f" spanning [{observed[0]},{observed[-1] + 1})" if observed else ""
            errors.append(f"{label} {direction}: expected opening [{lo},{hi}); measured "
                          f"{len(observed)} warm px{span}")
        elif observed:
            errors.append(f"{label} {direction}: expected closed edge; measured {len(observed)} warm px")

    width, height = mask.size
    centers = {"N": (width // 2, 1), "E": (width - 2, height // 2),
               "S": (width // 2, height - 2), "W": (1, height // 2)}
    # A small closing bridges painted cracks. Flood-fill uses four-way connectivity.
    kernel = 5 if port_width == 160 else 3
    components = mask.filter(ImageFilter.MaxFilter(kernel)).filter(ImageFilter.MinFilter(kernel))
    labels = {}
    for index, direction in enumerate(sorted(ports), 1):
        pixel = centers[direction]
        if components.getpixel(pixel) == 255:
            ImageDraw.floodfill(components, pixel, index)
        labels[direction] = components.getpixel(pixel)
        if labels[direction] == 0:
            errors.append(f"{label} {direction}: painted port center is closed")
    for first, second in itertools.combinations(sorted(ports), 2):
        expected = any({first, second} <= group for group in groups)
        actual = labels[first] == labels[second] != 0
        if actual != expected:
            errors.append(f"{label} {first}–{second}: painted connectivity = {actual}, expected {expected}")
    return errors, opening_widths


def edge_slice(image, port_width):
    width, height = image.size
    if width == 1:
        return image.crop((0, (height - port_width) // 2, 1, (height + port_width) // 2))
    return image.crop(((width - port_width) // 2, 0, (width + port_width) // 2, 1))


def measure_seams(tiles, port_width):
    pair_counts = Counter()
    max_difference = Counter()
    for (first_ports, first_edges), (second_ports, second_edges) in itertools.product(tiles, repeat=2):
        for direction in ("E", "S"):
            facing = OPPOSITE[direction]
            first_open, second_open = direction in first_ports, facing in second_ports
            if first_open != second_open:
                continue
            first, second = first_edges[direction], second_edges[facing]
            if first_open:
                first, second = edge_slice(first, port_width), edge_slice(second, port_width)
            difference = sum(ImageStat.Stat(ImageChops.difference(first, second)).mean) / 3
            pair_counts[first_open] += 1
            max_difference[first_open] = max(max_difference[first_open], difference)
    return (f"{pair_counts[True]} open and {pair_counts[False]} closed seams; "
            f"max mean RGB difference {max_difference[True]:.3f} open, {max_difference[False]:.3f} closed")


def check_geometry(manifest, tiles, board_scope):
    by_id = {card["id"]: card for card in manifest["cards"]}
    errors = []
    for purpose in CARD_SIZES:
        visual_tiles = []
        port_widths = []
        port_width = 160 if purpose == "standard" else 80
        for art_id, groups, rotations in tiles:
            variant = next(v for v in by_id[art_id]["variants"] if v["purpose"] == purpose)
            painted = check_entry(variant)
            if board_scope:
                require(variant["bytes"] <= card_budget(purpose), f"{variant['path']}: exceeds card budget")
            for rotation in rotations:
                rotated = painted.transpose(Image.Transpose.ROTATE_180) if rotation else painted
                mapping = OPPOSITE if rotation else {port: port for port in OPPOSITE}
                rotated_groups = [{mapping[port] for port in group} for group in groups]
                issues, widths = verify_ports(warm_ground(rotated), rotated_groups, port_width,
                                              f"{art_id} {purpose} {rotation}deg")
                errors.extend(issues)
                port_widths.extend(widths)
                visual_tiles.append((set().union(*rotated_groups), edges(rotated)))
        print(f"{purpose}: {len(visual_tiles) * 4} edge checks")
        if not board_scope:
            print(f"{purpose}: {measure_seams(visual_tiles, port_width)}")
        if port_widths:
            print(f"{purpose}: opening widths {min(port_widths)}–{max(port_widths)} px")
    return errors


def check_dist(entries, dist):
    require(dist.is_dir() and (dist / "index.html").is_file(), f"No Vite build found at {dist}")
    expected = Counter(entry["sha256"] for entry in entries)
    actual = Counter()
    errors = []
    for path in dist.rglob("*"):
        relative = path.relative_to(dist)
        if {"archive", "art-source", "references"} & {part.lower() for part in relative.parts}:
            errors.append(f"Unexpected source or historical output: {relative}")
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix == ".webp":
            digest = file_sha256(path)
            actual[digest] += 1
            if digest not in expected:
                errors.append(f"WebP outside the runtime allowlist: {relative}")
        elif suffix in IMAGE_SUFFIXES or suffix in ARCHIVE_SUFFIXES:
            errors.append(f"Unexpected raster/source format in output: {relative}")
    for digest, count in (expected - actual).items():
        paths = [entry["path"] for entry in entries if entry["sha256"] == digest]
        errors.append(f"Missing {count} allowlisted WebP output(s): {', '.join(paths)}")
    for digest, count in (actual - expected).items():
        if digest in expected:
            errors.append(f"{count} duplicate WebP output(s) for {digest}")
    print(f"Vite output: {sum(actual.values())} WebP")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scope", choices=("package", "tunnels", "board", "dist"))
    parser.add_argument("--owner-zip", type=Path, help="Compare package and source bytes with owner ZIP")
    parser.add_argument("--owner-preview", type=Path, help="Compare the preserved JPG with its ZIP member")
    parser.add_argument("--source-dir", type=Path, help="Compare normalized board inputs with preserved PNGs")
    parser.add_argument("--dist", type=Path, default=ROOT / "apps/web/dist")
    args = parser.parse_args()
    if (args.owner_zip or args.owner_preview) and args.scope != "package":
        parser.error("Owner archive checks apply to package scope")
    if args.owner_preview and not args.owner_zip:
        parser.error("--owner-preview requires --owner-zip")
    if args.source_dir and args.scope != "board":
        parser.error("--source-dir applies to board scope")
    try:
        manifest = read_json(MANIFEST_PATH)
        entries = package_entries(manifest)
        if args.scope == "package":
            errors = check_package(manifest, entries, args.owner_zip, args.owner_preview)
        elif args.scope == "tunnels":
            catalog, _ = active_data()
            tiles = [(card["id"], card["connections"], card["allowedRotations"])
                     for card in catalog if card["kind"] == "tunnel"]
            require(len(tiles) == 16 and all(rotations == [0, 180] for _, _, rotations in tiles),
                    "Expected 16 catalog tunnel geometries with 0° and 180° rotations")
            errors = check_geometry(manifest, tiles, board_scope=False)
        else:
            _, board = active_data()
            art = read_json(BOARD_MANIFEST_PATH)
            replacements = board_entries(art, board, args.source_dir)
            if args.scope == "board":
                errors = check_geometry(art, board_geometry(board), board_scope=True)
            else:
                errors = check_dist(entries + replacements, args.dist)
    except (BadZipFile, KeyError, OSError, ValueError) as error:
        print(f"Asset verification error: {error}", file=sys.stderr)
        return 1
    if errors:
        print(*errors, sep="\n", file=sys.stderr)
    print(f"{args.scope}: {len(errors)} errors")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
