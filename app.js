// 화면. criteria.json · keywords.json 은 처음에 읽고,
// data/answer.json 은 채점 단추를 누를 때만 읽는다.
// AI 는 /api/classify (서버 함수) 로만 묻는다. 열쇠는 브라우저에 없다.
(function () {
  var criteria = null;
  var keywords = null;
  var lastAI = null; // 내려받기용

  var $ = function (id) { return document.getElementById(id); };

  function showError(msg) {
    var el = $("error");
    el.textContent = msg;
    el.hidden = false;
  }

  function loadJSON(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " 을 읽지 못했습니다 (" + r.status + ")");
      return r.json();
    });
  }

  // AI 에 가린 문장 여러 개를 묻는다. 실패하면 Error(이유)
  function askAI(sentences) {
    return fetch("api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentences: sentences })
    }).then(function (r) {
      return r.json().catch(function () {
        throw new Error("서버 함수 답을 읽지 못했습니다 (" + r.status + ")");
      });
    }).then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || "알 수 없는 실패");
      return data;
    });
  }

  // 탭
  document.querySelectorAll(".tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        $(b.dataset.tab).hidden = !on;
      });
    });
  });

  // ── 분류 ──
  function showResult(masked, r, sourceText, fallback) {
    $("r-masked").textContent = masked;
    $("r-cat").textContent = "칸 · " + r.칸;
    $("r-urg").textContent = "긴급도 · " + r.긴급도;
    $("r-why").textContent = r.이유;
    $("r-source").textContent = sourceText;
    $("r-source").classList.toggle("fallback", !!fallback);
    $("result").hidden = false;
  }

  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!criteria || !keywords) return;
    var text = $("input").value.trim();
    if (!text) return;
    var masked = mask(text);
    var btn = $("classify-btn");
    btn.disabled = true;
    btn.textContent = "AI가 가르는 중…";

    askAI([masked]).then(function (data) {
      var r = data.results[0];
      if (r.error) throw new Error(r.error);
      showResult(masked, r, "AI(" + data.model + ")가 갈랐습니다", false);
    }).catch(function (err) {
      var r = classify(masked, criteria, keywords);
      showResult(masked, r, "AI 없이 규칙으로 갈랐습니다 — " + err.message, true);
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = "분류하기";
    });
  });
  $("input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("form").requestSubmit();
    }
  });

  // ── 채점 ──
  function pct(n, total) {
    return total ? Math.round((n / total) * 100) + "%" : "-";
  }

  // 판정 목록을 정답과 견준다. 판정이 null 이면 오답으로 센다
  function tally(answers, judged) {
    var worstCat = criteria.순서[0]; // 가장 나쁜 실수: 첫 칸(보안)을 다른 칸으로 놓침
    var s = { n: answers.length, cat: 0, urg: 0, both: 0, worstCat: worstCat, worstTotal: 0, worstMiss: 0, failed: 0 };
    answers.forEach(function (a, i) {
      var r = judged[i];
      if (!r) s.failed++;
      var okC = !!r && r.칸 === a.칸;
      var okU = !!r && r.긴급도 === a.긴급도;
      if (okC) s.cat++;
      if (okU) s.urg++;
      if (okC && okU) s.both++;
      if (a.칸 === worstCat) {
        s.worstTotal++;
        if (!okC) s.worstMiss++;
      }
    });
    return s;
  }

  function ruleJudge(answers) {
    return answers.map(function (a) { return classify(mask(a.문장), criteria, keywords); });
  }

  $("score-btn").addEventListener("click", function () {
    if (!criteria || !keywords) return;
    var btn = $("score-btn");
    btn.disabled = true;
    loadJSON("data/answer.json").then(function (answers) {
      var judged = ruleJudge(answers);
      var s = tally(answers, judged);
      var list = $("wrong");
      list.textContent = "";
      answers.forEach(function (a, i) {
        var r = judged[i];
        var okC = r.칸 === a.칸;
        var okU = r.긴급도 === a.긴급도;
        if (okC && okU) return;
        var li = document.createElement("li");
        var id = document.createElement("div");
        id.className = "id";
        id.textContent = a.id;
        var t = document.createElement("div");
        t.textContent = mask(a.문장);
        var d = document.createElement("div");
        d.className = "diff";
        d.appendChild(part(a.칸, r.칸, okC));
        d.appendChild(document.createTextNode(" · "));
        d.appendChild(part(a.긴급도, r.긴급도, okU));
        li.appendChild(id);
        li.appendChild(t);
        li.appendChild(d);
        list.appendChild(li);
      });

      $("w-cat").textContent = s.worstCat;
      $("w-n").textContent = s.worstMiss + " / " + s.worstTotal;
      $("w-desc").textContent = "정답이 " + s.worstCat + "인데 다른 칸으로 판정한 수";
      $("worst").classList.toggle("ok", s.worstMiss === 0);
      $("cond").textContent = "잰 조건: 규칙만 · keywords.json v" + keywords.version +
        " · criteria.json v" + criteria.version + " · data/answer.json " + s.n + "문장";
      $("s-cat").textContent = pct(s.cat, s.n) + " (" + s.cat + "/" + s.n + ")";
      $("s-urg").textContent = pct(s.urg, s.n) + " (" + s.urg + "/" + s.n + ")";
      $("s-both").textContent = s.both + "/" + s.n;
      $("wrong-count").textContent = "(" + (s.n - s.both) + ")";
      $("score-out").hidden = false;
    }).catch(function (err) {
      showError(err.message);
    }).finally(function () {
      btn.disabled = false;
    });
  });

  function part(answer, judged, ok) {
    var span = document.createElement("span");
    if (ok) {
      span.textContent = answer;
    } else {
      span.className = "miss";
      span.textContent = answer + " → " + judged;
    }
    return span;
  }

  // AI 로 채점: 10개씩 세 번 보낸다
  var BATCH = 10;

  $("ai-score-btn").addEventListener("click", function () {
    if (!criteria || !keywords) return;
    var btn = $("ai-score-btn");
    btn.disabled = true;
    $("score-btn").disabled = true;
    $("ai-out").hidden = false;
    $("ai-done").hidden = true;

    loadJSON("data/answer.json").then(function (answers) {
      var masked = answers.map(function (a) { return mask(a.문장); });
      var aiJudged = new Array(answers.length).fill(null);
      var aiError = new Array(answers.length).fill(null);
      var model = null;
      var batchErrors = [];
      var done = 0;
      var progress = function () {
        $("ai-progress").textContent = "AI 채점 중… " + done + "/" + answers.length;
      };
      progress();

      var chain = Promise.resolve();
      for (var start = 0; start < answers.length; start += BATCH) {
        (function (from) {
          chain = chain.then(function () {
            var part = masked.slice(from, from + BATCH);
            return askAI(part).then(function (data) {
              model = data.model;
              data.results.forEach(function (r, k) {
                if (r && !r.error) aiJudged[from + k] = r;
                else aiError[from + k] = (r && r.error) || "답 없음";
              });
            }).catch(function (err) {
              batchErrors.push(err.message);
              for (var k = 0; k < part.length; k++) aiError[from + k] = err.message;
            }).then(function () {
              done += part.length;
              progress();
            });
          });
        })(start);
      }

      return chain.then(function () {
        var ruleJudged = ruleJudge(answers);
        var rs = tally(answers, ruleJudged);
        var as = tally(answers, aiJudged);
        var when = new Date().toISOString();

        $("ai-progress").textContent = "AI 채점 끝 · " + answers.length + "/" + answers.length;
        $("ai-cond").textContent = "잰 조건: 모델 " + (model || "(답 없음)") + " · criteria.json v" + criteria.version +
          " · keywords.json v" + keywords.version + " · data/answer.json " + answers.length + "문장 · 가린 문장 · " + when;

        var rows = [
          ["칸 정확도", pct(rs.cat, rs.n) + " (" + rs.cat + ")", pct(as.cat, as.n) + " (" + as.cat + ")"],
          ["긴급도 정확도", pct(rs.urg, rs.n) + " (" + rs.urg + ")", pct(as.urg, as.n) + " (" + as.urg + ")"],
          ["둘 다 맞음", rs.both + "/" + rs.n, as.both + "/" + as.n],
          [rs.worstCat + " 놓침 (가장 나쁜 실수)", rs.worstMiss + "/" + rs.worstTotal, as.worstMiss + "/" + as.worstTotal, true],
          ["답 못 받음 (오답으로 셈)", "-", String(as.failed), as.failed > 0]
        ];
        var body = $("compare-body");
        body.textContent = "";
        rows.forEach(function (row) {
          var tr = document.createElement("tr");
          for (var c = 0; c < 3; c++) {
            var td = document.createElement("td");
            td.textContent = row[c];
            if (c === 2 && row[3]) td.className = "bad";
            tr.appendChild(td);
          }
          body.appendChild(tr);
        });

        $("ai-failed").textContent = as.failed
          ? "답을 못 받은 문장 " + as.failed + "개 — " + Array.from(new Set(aiError.filter(Boolean))).join(" / ")
          : "";

        lastAI = {
          조건: {
            모델: model,
            시각: when,
            criteria_version: criteria.version,
            keywords_version: keywords.version,
            문장_수: answers.length,
            보낸_문장: "가린 문장",
            묶음_크기: BATCH
          },
          요약: {
            규칙: { 칸: rs.cat, 긴급도: rs.urg, 둘다: rs.both, 보안_놓침: rs.worstMiss, 보안_정답수: rs.worstTotal },
            AI: { 칸: as.cat, 긴급도: as.urg, 둘다: as.both, 보안_놓침: as.worstMiss, 보안_정답수: as.worstTotal, 답_못_받음: as.failed }
          },
          묶음_오류: batchErrors,
          문장별: answers.map(function (a, i) {
            var ai = aiJudged[i];
            return {
              id: a.id,
              가린_문장: masked[i],
              정답: { 칸: a.칸, 긴급도: a.긴급도 },
              AI: ai ? { 칸: ai.칸, 긴급도: ai.긴급도, 이유: ai.이유 } : null,
              AI_실패_이유: aiError[i],
              규칙: { 칸: ruleJudged[i].칸, 긴급도: ruleJudged[i].긴급도 }
            };
          })
        };
        $("ai-done").hidden = false;
      });
    }).catch(function (err) {
      showError(err.message);
    }).finally(function () {
      btn.disabled = false;
      $("score-btn").disabled = false;
    });
  });

  $("ai-download").addEventListener("click", function () {
    if (!lastAI) return;
    var blob = new Blob([JSON.stringify(lastAI, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ai_채점결과.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // 시작
  Promise.all([loadJSON("criteria.json"), loadJSON("keywords.json")])
    .then(function (res) { criteria = res[0]; keywords = res[1]; })
    .catch(function (err) {
      showError(err.message + " — 폴더에서 작은 서버를 띄워 열어 주세요");
    });
})();
