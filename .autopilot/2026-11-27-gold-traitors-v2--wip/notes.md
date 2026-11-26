# Текущее состояние репозитория

Базовый коммит `a24dcf8`. Действует только ТЗ 2.0. Чистого игрового кода, npm-проекта, CI, серверных миграций и браузерных тестов в базовом коммите нет. `preview/index.html` представляет прежнюю галерею ассетов.

## Активные данные

- `data/game-config.json` выбирает `data/card-catalog-v2.json` и `data/rulesets/playtest-expedition-v0.json`. Публикация отключена, коммерческий профиль не задан.
- Каталог содержит 16 типов туннелей и 11 типов действий. Типы связаны с путями `asset` и `compactAsset`. Геометрия читается из `connections`, повороты 0° и 180°.
- В профиле `playtest-expedition-v0` суммы копий по типам 40 + 26 = 66. Все ID копий совпали с каталогом. Для 3–10 мест хватает общей колоды и число предателей строго меньше числа участников.
- Действующий профиль задаёт три камеры с публичным портом W. Роль камеры скрыта. Обе жилы должны одновременно оставаться достижимыми. Прежние конфигурации и архивация обозначены отдельно и не входят в игровой runtime.

## Базовые проверки

- `python -m unittest discover -s tests -v` проверяет прежний импорт. Один тест прошёл, один пропущен из-за отсутствия отдельной старой fixture `ASSET_ARCHIVE`.
- `tools/verify_assets.py` рассчитывает прежние 67 карт, 70 карточных WebP и 22 SVG по `data/cards.json`. Он перезаписывает исторический отчёт `data/asset-verification.json`. Для E0 2.0 выполнена самостоятельная сверка файлов, без запуска прежнего проверщика.
- Сверены размеры/хеши 101 записи старого манифеста и исходные пути базового коммита. В новой локальной поставке декодированы и сверены размеры, байты и SHA-256 всех 107 WebP (6 599 840 байт). Выборка читала только новый манифест и графику `assets/` из ZIP. Архив сохранён на месте.
- В новой локальной поставке найдены все пути активной конфигурации. Из 40 карточных иллюстраций 16 отмечены как проверенные по геометрии, 4 требуют проверки геометрии поля, 20 требуют художественной проверки. Оба фона имеют статус кандидатов. `assets/cards/roles/role-prospector.webp` весит 126 786 Б, на 3 906 Б больше целевых 120 КиБ.

## Файлы новой локальной поставки, которых нет в main

37 путей. Среди них десять вариантов пяти активных тупиков. Все 70 совпадающих карточных путей отличались по SHA-256, поэтому импортировать следует цельный новый растровый набор с его манифестом.

- `assets/board/mine-scene-corridor.webp`
- `assets/board/mine-scene-junction.webp`
- `assets/branding/logo-ru.webp`
- `assets/cards/compact/tunnel-separated-n-e-s-w.webp`
- `assets/cards/compact/tunnel-separated-n-e-s.webp`
- `assets/cards/compact/tunnel-separated-n-e-w.webp`
- `assets/cards/compact/tunnel-separated-n-e.webp`
- `assets/cards/compact/tunnel-separated-n-w.webp`
- `assets/cards/tunnels/tunnel-separated-n-e-s-w.webp`
- `assets/cards/tunnels/tunnel-separated-n-e-s.webp`
- `assets/cards/tunnels/tunnel-separated-n-e-w.webp`
- `assets/cards/tunnels/tunnel-separated-n-e.webp`
- `assets/cards/tunnels/tunnel-separated-n-w.webp`
- `assets/ui/icons/arrow-back.webp`
- `assets/ui/icons/arrow-next.webp`
- `assets/ui/icons/cards.webp`
- `assets/ui/icons/cart.webp`
- `assets/ui/icons/chat.webp`
- `assets/ui/icons/close.webp`
- `assets/ui/icons/collapse.webp`
- `assets/ui/icons/confirm.webp`
- `assets/ui/icons/copy.webp`
- `assets/ui/icons/crystal.webp`
- `assets/ui/icons/gold.webp`
- `assets/ui/icons/home.webp`
- `assets/ui/icons/info.webp`
- `assets/ui/icons/invite.webp`
- `assets/ui/icons/lantern.webp`
- `assets/ui/icons/lock.webp`
- `assets/ui/icons/pickaxe.webp`
- `assets/ui/icons/rotate.webp`
- `assets/ui/icons/scout.webp`
- `assets/ui/icons/settings.webp`
- `assets/ui/icons/sparkle.webp`
- `assets/ui/icons/volume.webp`
- `assets/ui/icons/zoom-in.webp`
- `assets/ui/icons/zoom-out.webp`

Новый манифест не содержит app-icon 192/512, social-cover, материалов панелей или утверждённых нейтральных аватаров. Документация E4 должна отмечать их открытый статус. В исходниках старые файлы можно сохранить как историю, а Vite/dist ограничить файлами нового растрового манифеста.
