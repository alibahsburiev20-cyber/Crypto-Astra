#!/usr/bin/env bash
# Сборка PNG-спрайтов из «ничего»: иконки кнопок, спрайты арены и фоны.
#
# Правило проекта: в интерфейсе нет SVG. Всё, что видит игрок, — PNG-файл.
# Скрипт воспроизводимый: ImageMagick рисует фигуры по координатам, поэтому
# картинки не «магические», их можно пересобрать и они не весят мегабайты.
#
# Запуск: bash scripts/build-sprites.sh   (нужен ImageMagick: convert)
set -euo pipefail
cd "$(dirname "$0")/.."

UI=client/icons/ui
NAV=client/icons/nav
ARENA=client/sprites/arena
BG=client/sprites/bg
mkdir -p "$UI" "$NAV" "$ARENA" "$BG"

# 4x-рендер + уменьшение: так края сглаживаются без SVG-рендерера.
S=192

# ── Иконки кнопок ───────────────────────────────────────────────────────────
# Общий стиль: тонкая светлая обводка, акцент — фиолетовый или голубой.
STROKE='#a9c4ff'

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill none \
  -draw "circle 96,96 96,34" \
  -draw "line 96,14 96,42" -draw "line 96,150 96,178" \
  -draw "line 14,96 42,96" -draw "line 150,96 178,96" \
  -fill '#8f7bff' -stroke none -draw "circle 96,96 96,82" \
  -resize 48x48 -depth 8 "$UI/arena.png"

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill none \
  -draw "roundrectangle 34,34 132,158 16,16" \
  -draw "path 'M 96,68 L 138,96 L 96,124'" \
  -draw "line 96,96 150,96" \
  -resize 48x48 -depth 8 "$UI/login.png"

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill none \
  -draw "circle 78,70 78,34" \
  -draw "path 'M 30,164 C 30,124 54,108 78,108 C 102,108 126,124 126,164'" \
  -stroke '#7de2b0' -draw "line 160,72 160,120" -draw "line 136,96 184,96" \
  -resize 48x48 -depth 8 "$UI/register.png"

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill none \
  -draw "path 'M 78,34 L 46,34 Q 30,34 30,50 L 30,146 Q 30,162 46,162 L 78,162'" \
  -draw "path 'M 120,66 L 88,96 L 120,126'" -draw "line 88,96 176,96" \
  -resize 48x48 -depth 8 "$UI/logout.png"

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill none -draw "circle 96,96 96,22" \
  -fill '#8f7bff' -stroke none -draw "polygon 80,66 134,96 80,126" \
  -resize 48x48 -depth 8 "$UI/play.png"

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill none \
  -draw "roundrectangle 34,80 158,166 14,14" \
  -draw "line 34,110 158,110" -draw "line 96,80 96,166" \
  -draw "roundrectangle 60,36 132,80 10,10" \
  -stroke '#ffcf6b' -draw "line 76,58 116,58" \
  -resize 48x48 -depth 8 "$UI/claim.png"

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill none \
  -draw "path 'M 160,96 A 64,64 0 1 1 120,38'" \
  -draw "path 'M 160,40 L 160,80 L 122,80'" \
  -resize 48x48 -depth 8 "$UI/refresh.png"

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill none \
  -draw "path 'M 24,40 L 52,40 L 76,124 L 148,124 L 168,64 L 60,64'" \
  -fill "$STROKE" -stroke none -draw "circle 84,158 84,148" -draw "circle 146,158 146,148" \
  -resize 48x48 -depth 8 "$UI/buy.png"

convert -size ${S}x${S} xc:none \
  -stroke '#ffcf6b' -strokewidth 12 -fill none \
  -draw "path 'M 64,32 L 128,32 L 128,72 A 32,32 0 0 1 64,72 Z'" \
  -draw "path 'M 64,48 L 40,48 L 40,64 A 24,24 0 0 0 64,88'" \
  -draw "path 'M 128,48 L 152,48 L 152,64 A 24,24 0 0 1 128,88'" \
  -draw "line 96,104 96,140" -draw "line 64,164 128,164" \
  -resize 48x48 -depth 8 "$UI/trophy.png"

convert -size ${S}x${S} xc:none \
  -stroke "$STROKE" -strokewidth 12 -fill "$STROKE" \
  -draw "polygon 30,74 74,74 122,38 122,154 74,118 30,118" \
  -fill none -draw "path 'M 146,72 A 30,30 0 0 1 146,120'" -draw "path 'M 164,52 A 52,52 0 0 1 164,140'" \
  -resize 48x48 -depth 8 "$UI/volume.png"

# ── Иконки навигации, которые раньше были SVG ───────────────────────────────
convert -size ${S}x${S} xc:none \
  -stroke '#ffcf6b' -strokewidth 10 -fill none \
  -draw "circle 96,96 96,24" \
  -fill '#ffcf6b' -stroke none \
  -draw "polygon 96,52 112,84 148,90 122,116 128,152 96,136 64,152 70,116 44,90 80,84" \
  -resize 40x40 -depth 8 "$NAV/bonus.png"

convert -size ${S}x${S} xc:none \
  -stroke '#a9c4ff' -strokewidth 10 -fill none \
  -draw "roundrectangle 24,52 168,148 14,14" \
  -draw "line 24,84 168,84" \
  -fill '#7de2b0' -stroke none -draw "roundrectangle 44,104 116,128 6,6" \
  -resize 40x40 -depth 8 "$NAV/pay.png"

# ── Спрайты арены ──────────────────────────────────────────────────────────

# Астероид: каменный шар с кратерами. Три варианта — чтобы поток не выглядел
# копипастой.
asteroid() {
  local out=$1 seed=$2
  convert -size 128x128 radial-gradient:'#c3cde6'-'#2c3450' \
    \( -size 128x128 xc:black -fill white -draw "circle 64,64 64,4" \) \
    -alpha off -compose CopyOpacity -composite \
    -fill '#7b87a6' -draw "circle $((40 + seed * 6)),$((48 + seed * 4)) $((40 + seed * 6)),$((38 + seed * 4))" \
    -fill '#586381' -draw "circle $((84 - seed * 4)),$((76 - seed * 3)) $((84 - seed * 4)),$((64 - seed * 3))" \
    -fill '#95a1bd' -draw "circle $((58 + seed * 3)),$((92 - seed * 2)) $((58 + seed * 3)),$((84 - seed * 2))" \
    -depth 8 "$out"
}
asteroid "$ARENA/asteroid_1.png" 1
asteroid "$ARENA/asteroid_2.png" 4
asteroid "$ARENA/asteroid_3.png" 7

# Кристалл: ромб с голубым свечением.
convert -size 128x128 xc:none \
  -fill '#66e6ff' -stroke '#d8fbff' -strokewidth 4 \
  -draw "polygon 64,10 112,64 64,118 16,64" \
  -fill '#aef4ff' -stroke none -draw "polygon 64,26 92,64 64,58" \
  -blur 0x2 -depth 8 "$ARENA/crystal.png"

# Корабль игрока: смотрит вверх, двигатели подсвечены.
convert -size 160x200 xc:none \
  -fill '#cfe1ff' -stroke '#8fb6ff' -strokewidth 5 \
  -draw "polygon 80,24 152,176 80,142 8,176" \
  -fill '#8fb6ff' -stroke none -draw "polygon 80,60 116,150 80,132 44,150" \
  -fill '#7de2b0' -draw "circle 62,178 62,168" -draw "circle 98,178 98,168" \
  -blur 0x1 -depth 8 "$ARENA/ship.png"

# Взрыв: кольцо и осколки, используется при пробоине.
convert -size 160x160 xc:none \
  -stroke '#ffb27b' -strokewidth 8 -fill none -draw "circle 80,80 80,24" \
  -stroke '#ff7b7b' -strokewidth 5 -draw "circle 80,80 80,44" \
  -fill '#ffd9a3' -stroke none \
  -draw "polygon 80,20 88,50 72,50" -draw "polygon 140,80 110,88 110,72" \
  -draw "polygon 80,140 72,110 88,110" -draw "polygon 20,80 50,72 50,88" \
  -blur 0x1 -depth 8 "$ARENA/boom.png"

# ── Фоны ───────────────────────────────────────────────────────────────────

# Звёздное небо: тёмный градиент, туманности и ~240 звёзд.
starfield() {
  local out=$1 w=$2 h=$3 count=$4
  local stars=()
  local i
  for ((i = 0; i < count; i += 1)); do
    local x=$((RANDOM % w))
    local y=$((RANDOM % h))
    local r=$((RANDOM % 3 + 1))
    local a=$((RANDOM % 40 + 40))
    stars+=(-fill "rgba(200,220,255,0.${a})" -draw "circle $x,$y $((x + r)),$y")
  done
  convert -size ${w}x${h} gradient:'#0a1430'-'#050912' \
    -fill 'rgba(90,120,255,0.16)' -draw "circle $((w / 4)),$((h / 5)) $((w / 4)),0" \
    -fill 'rgba(140,90,255,0.14)' -draw "circle $((w * 3 / 4)),$((h * 2 / 3)) $((w * 3 / 4)),$((h / 3))" \
    -blur 0x60 \
    -fill 'rgba(120,200,255,0.10)' -draw "circle $((w / 2)),$((h / 2)) $((w / 2)),$((h / 4))" \
    -blur 0x40 \
    "${stars[@]}" \
    -depth 8 "$out"
}

starfield "$BG/space.png" 1920 1200 260
starfield "$BG/arena.png" 1000 620 150
cp "$BG/space.png" "$BG/hero.png"

echo "спрайты собраны:"
find client/icons/ui client/icons/nav client/sprites/arena client/sprites/bg -name '*.png' -newer package.json | head -40

# ── Гараж, скины, медали, админка (этапы 14–15) ────────────────────────────
mkdir -p client/sprites/garage client/sprites/profile

# Ячейка гаража: рамка под корабль. Пустая — тёмная, занятая — светится.
slot() {
  local out=$1 ring=$2 inner=$3
  convert -size 192x192 xc:none \
    -stroke "$ring" -strokewidth 10 -fill "$inner" \
    -draw "roundrectangle 12,12 180,180 26,26" \
    -stroke "rgba(255,255,255,0.25)" -strokewidth 3 \
    -draw "roundrectangle 26,26 166,166 18,18" \
    -resize 128x128 -depth 8 "$out"
}
slot "$ARENA/../garage/slot_empty.png" 'rgba(120,150,220,0.55)' 'rgba(18,28,52,0.75)'
slot "$ARENA/../garage/slot_filled.png" 'rgba(120,220,255,0.85)' 'rgba(28,52,90,0.85)'
slot "$ARENA/../garage/slot_locked.png" 'rgba(120,130,160,0.35)' 'rgba(12,18,32,0.8)'

# Фон ангара: тот же космос, но с решёткой пола.
convert client/sprites/bg/arena.png \
  -fill 'rgba(90,150,255,0.06)' \
  -draw "rectangle 0,430 1000,620" \
  -stroke 'rgba(140,180,255,0.10)' -strokewidth 2 \
  -draw "line 0,470 1000,470" -draw "line 0,520 1000,520" -draw "line 0,570 1000,570" \
  -depth 8 client/sprites/garage/hangar_bg.png

# След двигателя: три цвета под скины. Кладётся под корабль в арене.
trail() {
  local out=$1 color=$2
  convert -size 64x160 xc:none \
    -fill "rgba($color,0.55)" -draw "polygon 32,0 52,120 32,160 12,120" \
    -blur 0x12 -depth 8 "$out"
}
trail "client/sprites/profile/trail_nebula.png" '110,220,255'
trail "client/sprites/profile/trail_ember.png" '255,150,90'
trail "client/sprites/profile/trail_premium.png" '210,170,255'

# Рамка профиля: кольцо вокруг аватара.
frame() {
  local out=$1 color=$2 width=$3
  convert -size 192x192 xc:none \
    -stroke "$color" -strokewidth "$width" -fill none \
    -draw "circle 96,96 96,10" \
    -blur 0x1 -resize 128x128 -depth 8 "$out"
}
frame "client/sprites/profile/frame_nebula.png" '#6fd3ff' 10
frame "client/sprites/profile/frame_ember.png" '#ff9a5a' 10
frame "client/sprites/profile/frame_premium.png" '#c9a6ff' 8

# Медали арены: 25 / 50 / 100 побед и недельная.
medal() {
  local out=$1 ring=$2 label=$3
  convert -size 192x192 xc:none \
    -fill 'rgba(20,30,55,0.9)' -stroke "$ring" -strokewidth 9 -draw "circle 96,96 96,18" \
    -stroke "$ring" -strokewidth 6 \
    -draw "polygon 96,44 108,80 148,80 116,102 128,140 96,118 64,140 76,102 44,80 84,80" \
    -depth 8 -resize 128x128 "$out"
  convert "$out" -gravity south -background none -splice 0x0 -fill "$ring" \
    -font DejaVu-Sans-Bold -pointsize 26 -annotate +0+6 "$label" "$out" 2>/dev/null || true
}
medal client/sprites/profile/medal_25.png '#8fd3ff' '25'
medal client/sprites/profile/medal_50.png '#ffd479' '50'
medal client/sprites/profile/medal_100.png '#c9a6ff' '100'
medal client/sprites/profile/medal_week.png '#7de2b0' 'W'

# Иконки админки и гаража.
convert -size ${S}x${S} xc:none \
  -stroke '#a9c4ff' -strokewidth 10 -fill none \
  -draw "roundrectangle 24,40 168,150 16,16" \
  -draw "line 24,76 168,76" -fill '#7de2b0' -stroke none \
  -draw "circle 52,106 52,96" -draw "circle 96,106 96,96" -draw "circle 140,106 140,96" \
  -resize 48x48 -depth 8 "$UI/admin.png"

convert -size ${S}x${S} xc:none \
  -stroke '#8fd3ff' -strokewidth 10 -fill none \
  -draw "line 96,20 96,172" -draw "line 30,60 162,132" -draw "line 162,60 30,132" \
  -draw "circle 96,96 96,70" -resize 48x48 -depth 8 "$UI/freeze.png"

convert -size ${S}x${S} xc:none \
  -stroke '#7de2b0' -strokewidth 12 -fill none \
  -draw "circle 96,96 96,24" -draw "line 96,58 96,134" -draw "line 58,96 134,96" \
  -resize 48x48 -depth 8 "$UI/grant.png"

convert -size ${S}x${S} xc:none \
  -stroke '#ffcf6b' -strokewidth 10 -fill none \
  -draw "roundrectangle 24,64 168,150 14,14" \
  -draw "line 24,96 168,96" -fill '#ffcf6b' -stroke none \
  -draw "roundrectangle 44,36 148,64 8,8" \
  -resize 48x48 -depth 8 "$UI/garage.png"

echo "дополнительные спрайты: гараж, скины, медали, админка"
