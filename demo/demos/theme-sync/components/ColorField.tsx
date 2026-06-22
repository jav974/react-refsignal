// A labelled color control: native swatch + hex text input, both driving the
// same `onChange`.

import {
  colorFieldCaption,
  colorFieldLabel,
  colorFieldRow,
  hexInput,
  swatchInput,
} from '../styles/theme-sync.styles';

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={colorFieldLabel}>
      <span style={colorFieldCaption}>{label}</span>
      <span style={colorFieldRow}>
        <input
          type="color"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          style={swatchInput}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          style={hexInput}
        />
      </span>
    </label>
  );
}
