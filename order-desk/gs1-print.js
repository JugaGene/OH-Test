/* GS1-128 + GreenPeas Pallet label 2026 layouts (A4). */
(function (w) {
  const W = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112"
  ];

  function barsSvg(values, h) {
    let x = 0;
    const m = 1.15;
    let r = "";
    values.forEach((code) => {
      const pat = W[code] || W[0];
      [...pat].forEach((ch, i) => {
        const ww = Number(ch) * m;
        if (i % 2 === 0) r += `<rect x="${x.toFixed(2)}" width="${ww}" height="${h}"/>`;
        x += ww;
      });
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${(x + 2).toFixed(1)}" height="${h}" viewBox="0 0 ${x} ${h}">${r}</svg>`;
  }

  function encode128(values, start) {
    const seq = [start, ...values];
    let sum = start;
    values.forEach((v, i) => {
      sum += v * (i + 1);
    });
    seq.push(sum % 103);
    seq.push(106);
    return seq;
  }

  function encodeCodeC(digitStr) {
    const d = String(digitStr).replace(/\D/g, "");
    const vals = [102];
    const even = d.length % 2 ? "0" + d : d;
    for (let i = 0; i < even.length; i += 2) vals.push(Number(even.slice(i, i + 2)));
    return encode128(vals, 105);
  }

  function encodeCodeB(text) {
    const vals = [102];
    [...String(text)].forEach((ch) => {
      const c = ch.charCodeAt(0);
      if (c >= 32 && c <= 127) vals.push(c - 32);
    });
    return encode128(vals, 104);
  }

  w.gpBarcodeGs1 = function (human, height) {
    const parts = String(human).match(/\(\d+\)[^(]*/g) || [human];
    const vals = [102];
    parts.forEach((part, idx) => {
      if (idx) vals.push(102);
      const d = part.replace(/[()]/g, "").replace(/\D/g, "");
      const even = d.length % 2 ? "0" + d : d;
      for (let i = 0; i < even.length; i += 2) vals.push(Number(even.slice(i, i + 2)));
    });
    const hasLetter = /[A-Za-z]/.test(human);
    const seq = hasLetter ? encodeCodeB(human.replace(/[()]/g, "")) : encode128(vals, 105);
    return `<div class="gs1">${barsSvg(seq, height || 62)}<div class="hr">${human}</div></div>`;
  };
})(window);
