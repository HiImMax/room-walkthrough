// Sample room (estimated from the photos, scaled from the 57" TV) and starter product library.
// All measurements are inches. x: 0 = picture wall (west), z: 0 = fireplace wall (north).

export const uid = () => Math.random().toString(36).slice(2, 10);

// Paint names are real Sherwin-Williams colours; the on-screen colour is an approximation.
export const PAINTS = [
  { name: 'Pure White SW 7005', hex: '#edece6' }, { name: 'Alabaster SW 7008', hex: '#edeae0' },
  { name: 'Agreeable Gray SW 7029', hex: '#d1cbc1' }, { name: 'Repose Gray SW 7015', hex: '#ccc9c0' },
  { name: 'Accessible Beige SW 7036', hex: '#d1c7b8' }, { name: 'Mindful Gray SW 7016', hex: '#bcb7ad' },
  { name: 'Sea Salt SW 6204', hex: '#cdd2ca' }, { name: 'Evergreen Fog SW 9130', hex: '#95978a' },
  { name: 'Naval SW 6244', hex: '#2f3d4c' }, { name: 'Iron Ore SW 7069', hex: '#434341' },
];
// Generic carpet / flooring tones (not tied to a specific product).
export const FLOORS = [
  { name: 'Light gray', hex: '#b4b1ac' }, { name: 'Greige', hex: '#b3aa9c' }, { name: 'Beige', hex: '#c7b9a2' },
  { name: 'Taupe', hex: '#978b7d' }, { name: 'Charcoal', hex: '#5d5c5b' }, { name: 'Cream', hex: '#ddd5c5' },
  { name: 'Oak', hex: '#b58a5c' }, { name: 'Walnut', hex: '#5b4030' },
];

// Cameron IV collection (Living Spaces). Sizes from the store listings; fabric names are the
// listed options, swatch colours are approximations.
const CAMERON_COLORS = [
  { name: 'Doodle Ivory Boucle', hex: '#e9e3d5' }, { name: 'Pebble Boucle', hex: '#b9b2a6' },
  { name: 'Ginger Chenille', hex: '#b5713f' }, { name: 'Red Weave', hex: '#9b4a3c' },
  { name: 'Lawn Weave', hex: '#7d8a5a' }, { name: 'Espresso Jacquard', hex: '#4b3528' },
  { name: 'Ebony Jacquard', hex: '#2e2c2b' },
];
const cam = (name, type, w, d, h, price, sku, props) => ({
  id: 'cameron-' + sku, name: 'Cameron IV ' + name, type, w, d, h, price, color: '#e6dfd0', color2: '#a65a43',
  colors: CAMERON_COLORS, props, link: `https://www.livingspaces.com/pdp-cameron-iv-${name.toLowerCase()}-${sku}`,
});
export const seedCatalog = () => [
  cam('Sofa', 'sofa', 99, 44, 40, 995, 349262, { seats: 3, pillows: true }),
  cam('Loveseat', 'loveseat', 72, 44, 40, 980, 349253, { seats: 2, pillows: true }),
  cam('Chair', 'chair', 63, 44, 40, 960, 349252, { seats: 1, pillows: true }),
  cam('Ottoman', 'ottoman', 54, 27, 18, 695, 349254),
];

export function emptyRoom(name, w, l, h) {
  return {
    name, version: 1,
    room: { w, l, h, ext: 0, wallColor: '#d9d7d3', floorColor: '#b4b1ac', floorType: 'carpet', ceilingColor: '#f2f1ee', walls: {} },
    objects: [], refPhotos: [],
  };
}

export function sampleScene() {
  const W = 168, L = 228, H = 96;
  const o = (type, name, x, z, rot, w, d, h, color, more = {}) => Object.assign({ id: uid(), type, name, x, z, y: 0, rot, w, d, h, color }, more);
  const fixed = { locked: true };
  return {
    name: 'Living Room', version: 1,
    room: {
      w: W, l: L, h: H, ext: 96, wallColor: '#d9d7d3', floorColor: '#aaa7a2', floorType: 'carpet', ceilingColor: '#f2f1ee',
      walls: { e: { color: '#beb7ab' }, s: { gaps: [[46, W]] } },
    },
    refPhotos: [],
    objects: [
      // fireplace wall
      o('builtin', 'Built-in shelves (left)', 21, 8, 0, 42, 16, H, '#f4f3ef', fixed),
      o('fireplace', 'Fireplace', 81, 20, 0, 78, 40, H, '#f3f1ec', { color2: '#b98a55', ...fixed }),
      o('builtin', 'Built-in shelves (right)', 144, 8, 0, 48, 16, H, '#f4f3ef', fixed),
      o('tv', 'TV (57")', 81, 21.5, 0, 57, 2, 33, '#111111', { y: 54 }),
      o('plant', 'Plant', 50, 31, 0, 16, 16, 24, '#4f7a45', { y: 12 }),
      o('basket', 'Wicker basket', 110, 31, 0, 17, 17, 14, '#9a8a70', { y: 12 }),
      // picture wall
      o('bins', 'Toy organizer', 7, 38, 90, 34, 12, 30, '#f4f4f2'),
      o('sofa', 'Sofa (current)', 20, 106, 90, 90, 38, 34, '#e8dfc6', { props: { seats: 2, skirt: true } }),
      o('picture', 'Skyline print', 1, 106, 90, 62, 1.5, 41, '#b8b8b8', { y: 46 }),
      o('table', 'End table', 14, 166, 90, 24, 24, 24, '#33221c', { group: 'lamp-table', props: { legW: 2.5 } }),
      o('lamp', 'Table lamp', 12, 166, 0, 17, 17, 29, '#5f6f73', { y: 24, group: 'lamp-table' }),
      // middle
      o('table', "Kids' table", 66, 108, 0, 24, 24, 20, '#2b4fc7', { color2: '#d6322c', props: { finish: 'plastic', legW: 1 } }),
      o('ceilingfan', 'Ceiling fan', 84, 112, 0, 52, 52, 14, '#5a3d2b', { y: H - 14, locked: true }),
      // window wall
      o('window', 'Window', 167, 96, 270, 110, 3, 54, '#f5f4f0', { y: 28, ...fixed }),
      o('basket', 'Rope basket', 156, 82, 0, 20, 20, 16, '#eeeae0'),
      o('chest', 'Cedar chest', 156, 122, 270, 44, 20, 22, '#5a3324'),
      o('wallart', 'Shuttlecock wall art', 167, 188, 270, 46, 1, 26, '#eee9dc', { y: 52, color2: '#d9692b', props: { shape: 'shuttle' } }),
      o('recliner', 'Reclining loveseat', 126, 203, 180, 78, 38, 40, '#b9b8b2', { color2: '#4a3024' }),
      // step-up to the kitchen
      o('door', 'Door', 23, 227, 180, 32, 4, 80, '#f1f0ec', fixed),
      o('steps', 'Steps', 66, 217, 180, 40, 22, 14, '#4a3326', fixed),
      o('platform', 'Kitchen floor (raised)', 107, 276, 0, 122, 96, 21, '#4a3326', { props: { ceilH: H }, ...fixed }),
      o('railing', 'Railing', 127, 230, 0, 82, 4, 36, '#5e4634', { y: 21, ...fixed }),
      o('wall', 'Kitchen wall (back)', 107, 322, 0, 122, 4, H, '#dddbd6', fixed),
      o('wall', 'Kitchen wall (window side)', 166, 276, 90, 96, 4, H, '#beb7ab', fixed),
      o('wall', 'Kitchen wall (left)', 46, 276, 90, 96, 4, H, '#dddbd6', fixed),
    ],
  };
}
