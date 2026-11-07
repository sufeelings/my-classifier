// 이름 · 전화번호 · 사번을 [이름] [전화번호] [사번] 으로 바꾼다.
// 확실한 것만 가린다.
(function (root) {
  var TITLES = "님|씨|사원|주임|대리|과장|차장|부장|팀장";

  function mask(text) {
    var t = String(text);

    // 전화번호: 01로 시작하는 휴대폰 번호. 하이픈 · 띄어쓰기 · 붙여쓰기 모두
    t = t.replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}(?!\d)/g, "[전화번호]");

    // 사번: «사번» 낱말 뒤의 영문·숫자
    t = t.replace(/(사번\s*[:：]?\s*)[A-Za-z0-9][A-Za-z0-9-]*/g, "$1[사번]");
    // 사번: 숫자 6자리
    t = t.replace(/(?<!\d)\d{6}(?!\d)/g, "[사번]");

    // 이름: 담당 · 담당자 · 요청자 뒤에 오는 한글 2~4글자
    t = t.replace(/((?:담당자|담당|요청자)\s+)[가-힣]{2,4}(?![가-힣])/g, "$1[이름]");
    // 이름: 한글 2~4글자 뒤에 (띄어 쓰고) 님 · 씨 · 직함이 온다
    t = t.replace(new RegExp("(?<![가-힣])[가-힣]{2,4}(?=\\s+(?:" + TITLES + "))", "g"), "[이름]");

    return t;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { mask: mask };
  else root.mask = mask;
})(this);
