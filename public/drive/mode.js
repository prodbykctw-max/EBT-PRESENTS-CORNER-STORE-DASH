// Which look the drive draws in: the comic ink look (the default, look.js) or the realistic look (real.js, real-post.js).
//   ?look=real in the page's URL, or startDrive({ look: 'real' }) from the store page. ?look=comic forces the comic look.
// `hooks` is how real.js reaches the few places that build shared materials and geometry (runner.js propMaterial and
// bakedGeometry): it fills the hooks in when it loads, and with the comic look it never loads, so every hook stays empty
// and those functions run exactly the code they always did.
export const look = { real: false };
export const hooks = {};

export function resolveLook(option) {
  const q = new URLSearchParams(location.search).get('look');
  look.real = q === 'real' || (q !== 'comic' && option === 'real');
  return look.real;
}
