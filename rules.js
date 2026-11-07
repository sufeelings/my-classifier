// 규칙으로 가른다. 낱말은 keywords.json, 칸 순서는 criteria.json 에서 읽는다.
(function (root) {
  function norm(s) {
    return String(s).replace(/\s+/g, "");
  }

  function hits(text, words) {
    var t = norm(text);
    return (words || []).filter(function (w) { return t.indexOf(norm(w)) !== -1; });
  }

  function classify(maskedText, criteria, keywords) {
    var why = [];

    // 칸: criteria.json 의 순서대로 보고, 처음 걸린 칸 (두 칸에 걸치면 앞 칸)
    var 칸 = null;
    for (var i = 0; i < criteria.순서.length; i++) {
      var name = criteria.순서[i];
      var h = hits(maskedText, (keywords.칸[name] || {}).낱말);
      if (h.length) { 칸 = name; why.push("«" + h.join("»·«") + "» → " + name); break; }
    }
    if (!칸) { 칸 = keywords.기본값.칸; why.push("칸 낱말 없음 → 기본 " + 칸); }

    // 긴급도: keywords.json 의 보는 순서대로
    var 긴급도 = null;
    var order = keywords.긴급도_보는_순서;
    for (var j = 0; j < order.length; j++) {
      var u = order[j];
      var hu = hits(maskedText, (keywords.긴급도[u] || {}).낱말);
      if (hu.length) { 긴급도 = u; why.push("«" + hu.join("»·«") + "» → " + u); break; }
    }
    if (!긴급도) { 긴급도 = keywords.기본값.긴급도; why.push("긴급도 낱말 없음 → 기본 " + 긴급도); }

    // 보정 (criteria.json 의 덧붙인 규칙)
    (keywords.보정 || []).forEach(function (r) {
      if (칸 === r.칸이 && 긴급도 === r.긴급도가) {
        칸 = r.바꿀_칸;
        why.push(r.까닭);
      }
    });

    return { 칸: 칸, 긴급도: 긴급도, 이유: why.join(" / ") };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { classify: classify, norm: norm };
  else root.classify = classify;
})(this);
