
/** The shared picture is always the small card, whatever the screen: the
 * forecast's markup and the brand stamp go into a fixed-width card on the
 * page colour, off screen, captured, and removed. Share controls stay out. */
export async function cardImage(source,{stamp='',adjust}={},doc=globalThis.document) {
  // Loaded on first share only. A path, not a bare name: the site build
  // bundles it and the dev server serves it as one bundle (its own imports
  // have no extensions, which neither browsers nor Node follow).
  const { toBlob }=await import('../node_modules/html-to-image/es/index.js');
  const frame=doc.createElement('div');
  frame.className='share-frame';
  frame.innerHTML=`<section class="forecast-panel share-card">${source.innerHTML}${stamp}</section>`;
  frame.querySelector('[data-share-control]')?.remove();
  // The picture may word things for a stranger who has no page around it.
  adjust?.(frame);
  doc.body.append(frame);
  try {
    // The frame waits off screen; the picture puts it back at the origin.
    const blob=await toBlob(frame,{pixelRatio:2,cacheBust:false,style:{position:'static',left:'0',top:'0'},
      fontEmbedCSS:brandFontCSS(doc)});
    if(!blob)throw new Error('Card image failed');
    return blob;
  } finally {frame.remove();}
}

// The brand fonts are inline data already; hand their rules over as they
// are, so the picture draws the stamp in the same pixel faces as the page.
function brandFontCSS(doc) {
  const rules=[];
  // Unbundled pages nest the rules in @import sheets; follow them.
  const visit=sheet=>{
    let list;try {list=sheet?.cssRules;}catch {return;}
    for(const rule of list??[]) {
      if(rule.type===CSSRule.IMPORT_RULE)visit(rule.styleSheet);
      else if(rule.type===CSSRule.FONT_FACE_RULE&&/Brand Pixel/.test(rule.style.getPropertyValue('font-family')))rules.push(rule.cssText);
    }
  };
  for(const sheet of doc.styleSheets)visit(sheet);
  return rules.join('\n');
}

/** Touch devices hand the picture to the system sheet (Xiaohongshu, X, chat
 * apps...). Elsewhere the caller shows its own menu: desktop sheets rarely
 * list those apps, and X post links cannot carry an image. */
export const prefersSystemShare=(file,nav=globalThis.navigator,match=globalThis.matchMedia)=>
  !!nav?.canShare?.({files:[file]})&&!!match?.('(pointer:coarse)')?.matches;

export function xPostUrl(text,url) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function downloadBlob(blob,name,doc=globalThis.document) {
  const link=doc.createElement('a');
  link.href=URL.createObjectURL(blob);link.download=name;
  doc.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(link.href),10_000);
}

export async function copyImage(blob,nav=globalThis.navigator) {
  if(!nav?.clipboard?.write||typeof ClipboardItem!=='function')return false;
  try {await nav.clipboard.write([new ClipboardItem({[blob.type]:blob})]);return true;}
  catch {return false;}
}
