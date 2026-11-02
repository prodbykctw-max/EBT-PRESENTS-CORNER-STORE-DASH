// Which look the drive draws in: the realistic look (real.js, real-post.js; the default) or the comic ink look (look.js).
//   The default is real. ?look=comic in the page's URL, or startDrive({ look: 'comic' }) from the store page, gives the ink look;
//   ?look=real forces real (the URL always wins over the option).
// `hooks` is how real.js reaches the few places that build shared materials and geometry (runner.js propMaterial and
// bakedGeometry): it fills the hooks in when it loads, and with the comic look it never loads, so every hook stays empty
// and those functions run exactly the code they always did. If real.js or its textures fail to load, fallbackToComic()
// makes it the comic look after all.
export const look = { real: false };
export const hooks = {};

/** the realistic look's code or textures didn't load: from here on the drive is the plain comic look */
export function fallbackToComic() { look.real = false; delete hooks.propMaterial; delete hooks.propGeo; }

export function resolveLook(option) {
  const q = new URLSearchParams(location.search).get('look');
  look.real = q === 'real' || (q !== 'comic' && option !== 'comic');
  if (!look.real) { delete hooks.propMaterial; delete hooks.propGeo; }   // a page that was real once (the store re-enters the drive) must not keep the hooks
  return look.real;
}
