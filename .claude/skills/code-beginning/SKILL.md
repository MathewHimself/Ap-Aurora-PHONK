---
name: code-beginning
description: Файловая архитектура для фронтенд-проектов на чистых HTML, CSS и JavaScript без сборщика — index.html только с разметкой, папки Stylesheets (style.css как точка входа с @import reset, fonts, layout, animation, adaptive), Javascripts/scripts.js, fonts и images. Используй этот скилл всякий раз, когда начинаешь новый сайт, лендинг, веб-прототип или интерактивную страницу, когда пользователь просит «разложить по файлам», «переделать архитектуру», «вынести стили/скрипты из index.html», упоминает «Code beginning» / «Code beggining», или когда правишь проект, где уже есть папки Stylesheets и Javascripts — даже если про структуру не сказано прямо.
---

# Code beginning

Единая структура для проектов на HTML + CSS + JS без сборки. Цель — чтобы в любом проекте было сразу понятно, где что лежит: разметка отдельно, стили разложены по назначению, скрипты отдельно, ассеты в своих папках.

## Структура

```
project/
├── index.html            только разметка
├── Stylesheets/
│   ├── style.css         точка входа: только @import, своих правил нет
│   ├── reset.css         обнуление стилей (Eric Meyer reset v2.0)
│   ├── fonts.css         @font-face для шрифтов из /fonts
│   ├── layout.css        переменные (:root), базовые стили и все компоненты
│   ├── animation.css     transition, @keyframes, prefers-reduced-motion
│   └── adaptive.css      медиазапросы
├── Javascripts/
│   └── scripts.js        вся логика страницы
├── fonts/                файлы шрифтов (woff2)
└── images/               картинки, иконки, favicon
```

Имена папок пишутся именно так, с заглавной буквы: `Stylesheets`, `Javascripts`. Папки `fonts` и `images` — со строчной. На хостингах вроде GitHub Pages регистр в путях важен.

## Правила

**index.html — только HTML.**
- Никаких `<style>` и атрибутов `style="…"`. Всё оформление — через классы в CSS.
- Никаких инлайновых `<script>` с кодом и обработчиков вида `onclick="…"`.
- Внешний вид, который зависит от данных (например, цвет группы), задаётся классом-модификатором (`.bus-cow { --c: var(--cow); }`), а не инлайновой переменной.
- Инлайновый `<svg>` допустим: это разметка.
- Подключается ровно один файл стилей: `<link rel="stylesheet" href="Stylesheets/style.css">` в `<head>`.
- Скрипты подключаются в конце `<body>`: сначала внешние библиотеки (CDN), затем `<script src="Javascripts/scripts.js"></script>`.

**style.css — только подключения, в таком порядке:**

```css
@import url("reset.css");
@import url("fonts.css");
@import url("layout.css");
@import url("animation.css");
@import url("adaptive.css");
```

Порядок важен: каждый следующий файл может переопределять предыдущий. Поэтому медиазапросы всегда последние. Если пользователь задал свой порядок подключения — используй его вместо этого.

**Что куда класть:**

| Файл | Что внутри |
|---|---|
| `reset.css` | Eric Meyer reset v2.0 без изменений (копия в `assets/template/Stylesheets/reset.css`). Не редактировать. |
| `fonts.css` | Только `@font-face`. Пути к файлам — `url("../fonts/…")`, потому что они считаются от папки `Stylesheets`. |
| `layout.css` | `:root` с токенами (цвета, размеры), `body`, базовые элементы, все блоки и компоненты, их состояния (`:hover`, `[aria-pressed]`, `.is-active`). |
| `animation.css` | Свойства `transition` и `animation`, все `@keyframes`, блок `@media (prefers-reduced-motion: reduce)`. |
| `adaptive.css` | Только `@media` по ширине экрана, от больших экранов к маленьким. |
| `scripts.js` | Весь JavaScript страницы, обёрнутый в IIFE, чтобы не засорять глобальную область. |

Пара тонкостей:
- `reset.css` ставит `body { line-height: 1 }`, поэтому в `layout.css` нужно вернуть читаемый интерлиньяж (1.3–1.5).
- Reset не трогает `button`, поэтому в `layout.css` должно быть `button { font: inherit; color: inherit; }`.
- Шрифты по возможности кладутся локально в `/fonts` (woff2), а не подключаются с Google Fonts.
- Новый CSS-файл добавляется только через `@import` в `style.css`, а не отдельным `<link>` в HTML.

## Новый проект

Запусти скрипт: он создаёт каркас и не перезаписывает уже существующие файлы.

```bash
python3 <путь-к-скиллу>/scripts/scaffold.py <папка-проекта> "Название проекта"
```

Потом наполняй файлы по правилам выше.

## Перевод существующего проекта на эту структуру

1. Создай недостающие папки и файлы скриптом `scaffold.py` (существующие он не тронет).
2. Вынеси все стили из `<style>` в `Stylesheets/`: transition, animation и keyframes — в `animation.css`, медиазапросы — в `adaptive.css`, `@font-face` — в `fonts.css`, всё остальное — в `layout.css`.
3. Убери все `style="…"` из разметки: для каждого заведи класс или модификатор в `layout.css`.
4. Вынеси код из `<script>` в `Javascripts/scripts.js`. Если JS добавляет или проверяет классы (`classList`), переименуй их вслед за CSS.
5. Скачай шрифты в `/fonts` и опиши их в `fonts.css`. Картинки и иконки перенеси в `/images` и поправь пути.
6. Проверь результат по чек-листу.

## Чек-лист

- [ ] В `index.html` нет `<style>`, `style="`, инлайнового JS и `on…="` обработчиков.
- [ ] В `<head>` подключён только `Stylesheets/style.css`.
- [ ] `style.css` содержит только `@import` в правильном порядке.
- [ ] У каждого класса из разметки есть правило в CSS, у каждого класса из JS — тоже.
- [ ] В `layout.css` нет `@media` по ширине и `@keyframes`.
- [ ] Пути: в CSS к шрифтам и картинкам — через `../`, в HTML — от корня проекта.
- [ ] `node --check Javascripts/scripts.js` проходит без ошибок.
