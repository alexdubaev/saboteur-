"""Export the alpha board candidates from the preserved ImageGen PNGs."""

import argparse
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops

from verify_assets_v2 import (
    BOARD_MANIFEST_PATH,
    BOARD_SOURCE_DIR,
    CARD_SIZES,
    MANIFEST_PATH,
    ROOT,
    active_data,
    board_geometry,
    board_tile_path,
    card_budget,
    raster,
    read_json,
    require,
    sha256,
    verify_ports,
    warm_ground,
)
QUALITY_STEPS = (94, 92, 90, 88, 86, 84, 82, 80)


def edge_weights(size, depth):
    width, height = size

    def axis_weights(length):
        values = []
        for i in range(length):
            distance = min(i, length - 1 - i)
            # Hold the first two pixels at the donor color across the port sample.
            t = max(0, min(1, (depth - distance) / (depth - 2)))
            values.append(round(255 * t * t * (3 - 2 * t)))
        line = Image.new("L", (length, 1))
        line.putdata(values)
        return line

    sides = axis_weights(width).resize(size, Image.Resampling.NEAREST)
    ends = axis_weights(height).transpose(Image.Transpose.TRANSPOSE).resize(size, Image.Resampling.NEAREST)
    return ImageChops.lighter(sides, ends)


def tunnel_edge_images(owner_manifest):
    donor_ids = ("tunnel-cross", "tunnel-dead-end-e")
    donors = {}
    for card in owner_manifest["cards"]:
        if card["id"] in donor_ids:
            for variant in card["variants"]:
                data = (ROOT / variant["path"]).read_bytes()
                require(sha256(data) == variant["sha256"], f"Donor hash mismatch: {variant['path']}")
                purpose = variant["purpose"]
                image = raster(data, CARD_SIZES[purpose], variant["path"], "WEBP")
                if card["id"] == "tunnel-dead-end-e":
                    image = image.transpose(Image.Transpose.ROTATE_180)
                donors[card["id"], purpose] = image
    return donors


def encode(image, groups, purpose, art_id):
    port_width = 160 if purpose == "standard" else 80
    budget = card_budget(purpose)
    for quality in QUALITY_STEPS:
        stream = BytesIO()
        image.save(stream, "WEBP", quality=quality, method=6)
        data = stream.getvalue()
        if len(data) > budget:
            continue
        compressed = raster(data, image.size, art_id, "WEBP")
        errors, _ = verify_ports(warm_ground(compressed), groups, port_width, art_id)
        if not errors:
            return data, quality
    raise ValueError(f"{art_id} {purpose}: could not meet the edge geometry and {budget}-byte budget")


def prepare(source_dir):
    _, board = active_data()
    start_id = board["origin"]["assetId"]
    donors = tunnel_edge_images(read_json(MANIFEST_PATH))
    masks = {purpose: edge_weights(size, 56 if purpose == "standard" else 28)
             for purpose, size in CARD_SIZES.items()}
    cards = []
    outputs = {}
    for art_id, groups, _ in board_geometry(board):
        source = f"{art_id}.png"
        original_bytes = (source_dir / source).read_bytes()
        original = raster(original_bytes, (1024, 1536), source, "PNG")
        variants = []
        donor_id = "tunnel-cross" if art_id == start_id else "tunnel-dead-end-e"
        components = [set(group) for group in groups]
        for purpose, size in CARD_SIZES.items():
            draft = original.resize(size, Image.Resampling.LANCZOS)
            image = Image.composite(donors[donor_id, purpose], draft, masks[purpose])
            data, quality = encode(image, components, purpose, art_id)
            path = board_tile_path(art_id, purpose)
            variants.append({"purpose": purpose, "path": path, "width": size[0], "height": size[1],
                             "bytes": len(data), "sha256": sha256(data)})
            outputs[path] = data
            print(f"{path}: {len(data)} B at WebP quality {quality}")
        cards.append({"id": art_id, "source": f"{BOARD_SOURCE_DIR}/{source}", "sourceSha256": sha256(original_bytes),
                      "status": "art-review-required", "variants": variants})
    manifest = {"schemaVersion": 1, "cards": cards}
    for path, data in outputs.items():
        destination = ROOT / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    (ROOT / BOARD_MANIFEST_PATH).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    args = parser.parse_args()
    try:
        prepare(args.source_dir)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Board export error: {error}\n")


if __name__ == "__main__":
    main()
