# Naruto pack — prompt gen 54 icon chiêu

Icon vào HUD ở **128x128**, nên đọc được ở cỡ ~32px mới đạt. Gen ở 512x512 rồi
mình sẽ resize + nén webp qua pipeline `import-art.mjs`.

## Cách dùng

Dán **STYLE** + một dòng **Subject** bên dưới. Style giữ nguyên từng chữ cho cả
54 cái — đó là thứ duy nhất làm chúng trông cùng một bộ. Đổi style giữa chừng là
thanh chiêu trông như ghép từ 3 game khác nhau.

### STYLE (dán trước mọi prompt)

```
Anime-style video game ability icon, square 1:1 composition, single centered
subject filling 80% of the frame, dark desaturated background with a subtle
radial glow behind the subject, bold rim lighting, thick clean linework,
cel-shaded with strong contrast, one vibrant saturated focal color, no text,
no border, no UI frame, instantly readable as a silhouette at small size.
Subject:
```

### NEGATIVE (nếu tool có ô negative)

```
text, letters, numbers, watermark, signature, border, frame, UI panel,
multiple panels, collage, split image, photorealistic, 3d render, blurry,
low contrast, busy cluttered background, full body character, small subject
```

---

## Naruto — 7 icon

| id | Tên | Subject |
|---|---|---|
| `Naruto_Q` | Rasengan | a swirling sphere of dense chakra held in an open palm, tight spiral vortex pattern, electric blue and white |
| `Naruto_W` | Kage Bunshin | three overlapping orange-clad ninja silhouettes fanning out from one, motion after-images, orange and white |
| `Naruto_E` | Sennin Mōdo | a pair of glowing toad eyes with horizontal bar pupils, orange pigment markings around them, warm amber glow |
| `Naruto_R` | Kurama Mode | a nine-tailed fox wreathed in golden chakra flame, tails fanned out behind it, gold and crimson |
| `Naruto_Q2` | Bijuu Rasengan | a massive black-and-crimson sphere of compressed chakra crackling with red lightning, dark red and black |
| `Naruto_W2` | Kurama Arms | two elongated golden chakra arms reaching forward with open clawed hands, glowing energy trails |
| `Naruto_E2` | Bijuudama | a perfectly spherical black orb of condensed energy with swirling dark violet and crimson bands, ominous glow |

## Sasuke — 7 icon

| id | Tên | Subject |
|---|---|---|
| `Sasuke_Q` | Chidori | a hand crackling with a dense ball of white-blue lightning, jagged electric arcs, cold blue |
| `Sasuke_W` | Gōkakyū | a great roaring fireball hurled forward, orange and yellow flame with curling black smoke |
| `Sasuke_E` | Sharingan | a single crimson eye with three black comma-shaped tomoe around the pupil, red and black |
| `Sasuke_R` | Susanoo | a towering translucent spectral warrior with a glowing ribcage, violet ethereal glow |
| `Sasuke_Q2` | Yasaka Magatama | three purple crescent comma-shaped chakra blades arranged in a spinning cross formation, violet energy |
| `Sasuke_W2` | Amaterasu | pitch-black flames burning with an inverted dark aura, black fire tongues rimmed in deep red |
| `Sasuke_E2` | Indra's Arrow | a colossal arrow of white-purple lightning drawn on a spectral bow, blinding electric core |

## Kakashi — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Kakashi_Q` | Raikiri | a hand thrust forward trailing a screaming white lightning blade, sharp electric discharge |
| `Kakashi_W` | Suiryūdan | a serpentine water dragon rearing up with glowing eyes, translucent blue coils |
| `Kakashi_E` | Sao Chép | a single red sharingan eye mirrored inside a rippling reflection, red and silver |
| `Kakashi_R` | Kamui | a spiraling black-and-red vortex warping space inward toward a single point |

## Sakura — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Sakura_Q` | Shannarō | an armored fist smashing into cracked stone ground, radiating shockwave rings, pink and grey |
| `Sakura_W` | Sōzō Saisei | a glowing violet rhombus seal on a forehead with pigment lines spreading outward, jade-green healing light |
| `Sakura_E` | Chakra Scalpel | a hand emitting a thin flat blade of pale chakra like a surgical edge, mint green glow |
| `Sakura_R` | Katsuyu | a giant white slug with soft blue markings, gentle radiating healing aura, white and cobalt |

## Neji — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Neji_Q` | Jūken | an open palm strike releasing a pale blue chakra pulse into a glowing network of pressure points |
| `Neji_W` | Kaiten | a spinning dome of pale blue chakra deflecting projectiles outward, rotating sphere |
| `Neji_E` | Byakugan | a featureless pale lavender eye with bulging veins radiating from its corner, white and violet |
| `Neji_R` | 64 Chưởng | a dense circular mandala of glowing palm-strike impact points, concentric rings, cyan |

## Shikamaru — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Shikamaru_Q` | Kagemane | a long black shadow tendril stretching across the ground toward a bound silhouette, black and violet |
| `Shikamaru_W` | Kage Nui | many sharp black shadow spikes erupting upward from the ground like needles |
| `Shikamaru_E` | Kage Kubishibari | a black shadow hand rising and closing into a grip, stark black on cold grey |
| `Shikamaru_R` | Bẫy Nổ | a paper talisman with abstract seal markings wired to a taut tripwire, crimson on white |

## Gaara — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Gaara_Q` | Sabaku Kyū | a clenched fist of swirling sand crushing inward, tan and ochre grains spiraling |
| `Gaara_W` | Suna no Tate | a curved wall of dense sand rising as a protective barrier, layered dune texture |
| `Gaara_E` | Sabaku Sōsō | a cresting tidal wave of desert sand sweeping forward, golden dust plume |
| `Gaara_R` | Shukaku | a monstrous one-tailed tanuki made of sand with dark spiral markings and glowing eyes, ochre and black |

## Temari — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Temari_Q` | Kamaitachi | crescent blades of cutting wind slicing forward, pale cyan vacuum arcs |
| `Temari_W` | Quạt Gió | a large open folding war fan with three purple moon crests sweeping a gust, wind streaks |
| `Temari_E` | Fūton | a swirling updraft of green-white wind lifting dust in a spiral column |
| `Temari_R` | Kirikiri Mai | a towering tornado vortex with a weasel silhouette carrying a scythe inside it, teal and white |

## Zabuza — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Zabuza_Q` | Kubikiribōchō | an enormous cleaver broadsword with a crescent hole in the blade, caught mid-swing, steel grey |
| `Zabuza_W` | Kirigakure | a thick rolling bank of white mist swallowing a dark silhouette, heavy low-visibility haze |
| `Zabuza_E` | Suirō | a figure trapped inside a perfect sphere of water, sealed bubble, deep blue |
| `Zabuza_R` | Daibakufu | a colossal crashing waterfall torrent surging forward, white foam over deep blue |

## Haku — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Haku_Q` | Senbon | a fan of thin steel needles flying in tight formation, cold silver on pale blue |
| `Haku_W` | Hyōshō | tall vertical ice mirrors arranged in a ring, each holding a faint reflected silhouette, pale cyan |
| `Haku_E` | Băng Độn | a streak of crystalline ice trailing behind a blurred dash, scattering frost shards |
| `Haku_R` | Vòm Gương | a full dome of hexagonal ice mirrors enclosing the frame, refracted light, icy white-blue |

## Itachi — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Itachi_Q` | Shuriken Lửa | a spinning four-pointed steel shuriken wrapped in trailing fire |
| `Itachi_W` | Tsukuyomi | a crimson-and-black distorted moon hanging over an inverted world, red sky and black clouds |
| `Itachi_E` | Karasu Bunshin | a body dissolving into a burst of scattering black crows and feathers, black on deep red |
| `Itachi_R` | Susanoo | a spectral crimson warrior holding a sealing sword and an ornate mirror shield, red ethereal glow |

## Deidara — 4 icon

| id | Tên | Subject |
|---|---|---|
| `Deidara_Q` | C1 | small white clay birds in flight, about to detonate, pale clay white on smoky grey |
| `Deidara_W` | C2 Rồng | a large white clay dragon soaring with an open maw, sculpted clay texture |
| `Deidara_E` | Nhện Đất Sét | a white clay spider crouched on the ground, primed and waiting |
| `Deidara_R` | C4 | an enormous billowing explosion cloud rising like a mushroom, white-hot core |

---

## Khi gen xong

Bỏ 54 file vào `naruto/assets/images/spells/`, đặt tên **đúng id viết thường**:
`naruto_q.png`, `naruto_q2.png`, `sasuke_w2.png`, … Pipeline sẽ tự resize 128,
nén, và ghi hash vào `assets/source-manifest.json` như pack dota.

Không cần trong suốt — nền tối đặc là được, HUD tự vẽ khung.
