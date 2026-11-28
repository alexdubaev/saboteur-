# Записи для звука шахты

Для тестовой браузерной игры использованы аудиозаписи Freesound под [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Фрагменты вырезаны из общедоступных MP3-превью авторов, эквализированы и сведены для игры. Браузер воспроизводит фон отдельной дорожкой, а игровые эффекты получает из общего банка. При недоступности Web Audio медиаплеер также воспроизводит сигналы старта и своего хода.

| Исходный файл | Запись и автор | Использование |
| --- | --- | --- |
| `pick.mp3` | [Pick Hitting Rock — spookymodem](https://freesound.org/people/spookymodem/sounds/202103/) | Серии ударов кирки |
| `hit.mp3` | [Stone hit — CamoMano](https://freesound.org/people/CamoMano/sounds/431019/) | Контакт туннельной карты и камня |
| `cart.mp3` | [minecart.wav — wmquincy101](https://freesound.org/people/wmquincy101/sounds/351382/) | Проезд вагонетки |
| `voice.mp3` | [Voice Man hey calling far away shout — ValentinPetiteau](https://freesound.org/people/ValentinPetiteau/sounds/557375/) | Оклики в дальнем тоннеле |
| `crew.mp3` | [Hey - Men Shouting together — khenshom](https://freesound.org/people/khenshom/sounds/527740/) | Несколько голосов с эхом |
| `cave.mp3` | [cave dripping water — mentos987](https://freesound.org/people/mentos987/sounds/818888/) | Фоновый воздух и капли |
| `rock.mp3` | [Bricks/Stones/Rocks/Gravel Falling — iwanPlays](https://freesound.org/people/iwanPlays/sounds/567249/) | Сыплющиеся камни при обвале |
| `metal.mp3` | [Scrap metal dropping / crashing — SamsterBirdies](https://freesound.org/people/SamsterBirdies/sounds/587443/) | Поломка и фиксация инструмента |
| `wrench.mp3` | [wrench 01.wav — Anthousai](https://freesound.org/people/Anthousai/sounds/399012/) | Храповик при ремонте |
| `stone.mp3` | [Heavy Stone Push — msavioti](https://freesound.org/people/msavioti/sounds/558254/) | Укладка туннеля и открытие камеры |
| `cards.mp3` | [Playing cards - Shuffling deck & deal — Vrymaa](https://freesound.org/people/Vrymaa/sounds/734631/) | Шорох карт при раздаче, разведке и сбросе |
| `coins.mp3` | [handful-of-coins-007 — ilyaShevelev](https://freesound.org/people/ilyaShevelev/sounds/847350/) | Звон монет при находке золота |

Для пересборки сохраните исходные MP3-превью под указанными именами в одну папку. Запустите `python tools/generate_game_sounds.py <папка>` при доступном FFmpeg. Банк `apps/web/src/audio/mine.mp3`, метаданные кадров `mine.json` и отдельные дорожки `mine-*.mp3` обновляются вместе.
