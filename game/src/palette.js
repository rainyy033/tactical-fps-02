// The look plan, in one place. Six neutral surfaces keep the UI chrome legible, and three role
// hues (the two teams plus a neutral site accent) appear only in the scene and HUD, so the
// whole game stays on one deliberate palette rather than picking colours ad hoc.
export const PALETTE = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  friendly: '#4cc9f0',
  enemy: '#ff5a5f',
  site: '#7ee0a6',
};

export function shade(name) {
  return PALETTE[name];
}
