# HA LCARS Sliders

`custom:lcars-slider-button` is a standalone Home Assistant Lovelace slider with two LCARS-inspired visuals:

- `environment`: segmented environmental gauge inspired by Star Trek: The Next Generation displays.
- `transporter`: discrete-level control inspired by the TNG transporter console.

## Installation

1. Copy `lcars-slider-button.js` to the Home Assistant `www` directory.
2. Add `/local/lcars-slider-button.js` as a JavaScript module in **Settings > Dashboards > Resources**.
3. Add a card using `type: custom:lcars-slider-button`.

## Minimal configuration

```yaml
type: custom:lcars-slider-button
visual: environment
mode: slider
entity: sensor.room_temperature
pointer_entity: climate.room
pointer_attribute: temperature
control_entity: climate.room
min: 16
max: 30
step: 1
unit: °C
```

Use `visual: transporter` for the alternative appearance. Both visuals support:

- graphical Lovelace editor;
- `vertical` and `horizontal` orientations;
- normal and reversed fill direction;
- horizontal sizing at 100% of the available width with configurable pixel height;
- fixed configurable pixel width and height in vertical orientation;
- automatic scale recalculation through `ResizeObserver`;
- Home Assistant gauge-compatible `needle` and `severity` bands;
- independent displayed, indicator, selector, target, and control entities;
- pointer and keyboard control;
- scale labels calculated from the available space;
- independent display units through `scale_divisor`, `scale_unit`, and `scale_decimals`;
- an optional value label inside the slider;
- an optional `name` rendered below horizontal sliders.

The graphical editor keeps focus while typing or holding a numeric stepper control, so values can be entered continuously.

See [`examples.yaml`](examples.yaml) for complete configurations.

## Version

Current stable release: `v1.2.0`.

## License

MIT
