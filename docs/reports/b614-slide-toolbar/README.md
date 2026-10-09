# B614 - slide toolbar belongs to the slide

Each image stacks four strips, separated by a magenta rule: 1440 px before, 1440 px after, 900 px before, 900 px after. `light.png` and `dark.png` show both UI modes.

Before, the slide toolbar was white with a hairline under it, so it read as a second deck bar. After, it sits on the canvas tone with no line and less room below than above; the topbar stays the only white chrome bar.

The review found one line left: the generic `.panel` border still drew a hairline along the top of the canvas column, right under the bar. `after-review-*.png` show the editor once that border is gone (1440 px light and dark, 900 px light).
