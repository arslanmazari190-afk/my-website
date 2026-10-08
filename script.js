(() => {
      "use strict";

      const STARTING_BALANCE = 1000;
      const WAIT_MS = 5000;
      const CRASH_PAUSE_MS = 3000;
      const MAX_BET = 10000;
      const $ = (id) => document.getElementById(id);

      const canvas = $("gameCanvas");
      const ctx = canvas.getContext("2d");
      const chartWrap = $("chartWrap");
      const multiplierEl = $("multiplier");
      const messageEl = $("gameMessage");
      const statusLine = $("statusLine");
      const statusText = $("statusText");
      const betGrid = $("betGrid");
      const balanceValue = $("balanceValue");
      const toastEl = $("toast");
      const liveBetsEl = $("liveBets");
      const myBetsEl = $("myBets");
      const roundHistoryEl = $("roundHistory");

      let balance = STARTING_BALANCE;
      let phase = "waiting";
      let phaseStartedAt = performance.now();
      let roundNumber = 1;
      let currentMultiplier = 1;
      let crashMultiplier = chooseCrashPoint();
      let flightElapsed = 0;
      let soundEnabled = false;
      let audioContext = null;
      let lastTickAt = 0;
      let lastLiveRefreshAt = 0;
      let toastTimer = 0;
      const aircraftAudio = {
        takeoff: new Audio("assets/aircraft-takeoff.mp3"),
        landing: new Audio("assets/aircraft-landing.mp3")
      };
      Object.values(aircraftAudio).forEach((clip) => {
        clip.preload = "auto";
        clip.volume = .52;
      });
      let chartSize = { width: 0, height: 0, dpr: 1 };
      let particles = [];
      const roundHistory = [];
      const myHistory = [];
      const bets = [
        { amount: 10, autoEnabled: false, autoAt: 2, state: "idle", placedAmount: 0, cashoutAt: null },
        { amount: 10, autoEnabled: false, autoAt: 2, state: "idle", placedAmount: 0, cashoutAt: null }
      ];
      const botNames = ["SkyRider", "LunaFly", "AcePilot", "Mila_77", "CloudNine", "JetStream", "NovaFox", "RedWing", "LuckyComet", "Airborne"];
      let liveRows = [];

      function money(value) {
        return "PKR " + Math.max(0, value).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      function chooseCrashPoint() {
        return Math.min(100, Math.max(1.01, 1.01 + Math.pow(Math.random(), 3.15) * 98.99));
      }

      function setBalance() {
        balanceValue.textContent = money(balance);
      }

      function showToast(message) {
        toastEl.textContent = message;
        toastEl.classList.add("show");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 2400);
      }

      function audio() {
        if (!soundEnabled) return null;
        if (!audioContext) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) {
            soundEnabled = false;
            updateSoundButton();
            showToast("Web Audio is not supported in this browser.");
            return null;
          }
          audioContext = new AudioContextClass();
        }
        if (audioContext.state === "suspended") audioContext.resume();
        return audioContext;
      }

      function tone(frequency, duration, type, volume, endFrequency) {
        const ac = audio();
        if (!ac) return;
        const oscillator = ac.createOscillator();
        const gain = ac.createGain();
        const start = ac.currentTime;
        oscillator.type = type || "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(.001, start + duration);
        oscillator.connect(gain);
        gain.connect(ac.destination);
        oscillator.start(start);
        oscillator.stop(start + duration);
      }

      function playSound(name) {
        if (!soundEnabled) return;
        if (name === "takeoff") {
          playAircraftAudio("takeoff");
        } else if (name === "tick") {
          tone(760, .055, "sine", .012);
        } else if (name === "cashout") {
          playAircraftAudio("landing");
        } else if (name === "crash") {
          tone(180, .62, "triangle", .065, 48);
          window.setTimeout(() => tone(95, .42, "sawtooth", .028, 42), 120);
        }
      }

      function playAircraftAudio(name) {
        const clip = aircraftAudio[name];
        if (!clip) return;
        Object.values(aircraftAudio).forEach((otherClip) => {
          if (otherClip !== clip) {
            otherClip.pause();
            otherClip.currentTime = 0;
          }
        });
        if (!clip.paused) return;
        clip.currentTime = 0;
        clip.play().catch(() => {
          showToast("Aircraft audio could not play. Check that the audio files are available.");
        });
      }

      function updateSoundButton() {
        const button = $("soundToggle");
        button.title = soundEnabled ? "Sound on" : "Sound off";
        button.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
        $("soundIcon").innerHTML = soundEnabled
          ? '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'
          : '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m19 5-6 14"/>';
      }

      function betCardMarkup(index) {
        return `
          <article class="bet-card" aria-label="Bet ${index + 1}">
            <div class="bet-heading"><span class="bet-title">Bet ${index + 1}</span><span class="bet-state" id="betState${index}">Ready</span></div>
            <div class="amount-row">
              <label class="amount-input-wrap" aria-label="Bet ${index + 1} amount in Pakistani rupees">
                <span class="currency-prefix">PKR</span><input class="amount-input" id="amount${index}" type="number" min="1" max="${MAX_BET}" step="0.01" value="10.00" inputmode="decimal">
              </label>
              <button class="bet-action place" id="betAction${index}" type="button">Place bet</button>
            </div>
            <div class="quick-buttons" aria-label="Quick amount controls">
              <button class="quick-button" type="button" data-bet="${index}" data-adjust="1">+1</button>
              <button class="quick-button" type="button" data-bet="${index}" data-adjust="5">+5</button>
              <button class="quick-button" type="button" data-bet="${index}" data-adjust="10">+10</button>
              <button class="quick-button" type="button" data-bet="${index}" data-adjust="50">+50</button>
              <button class="quick-button" type="button" data-bet="${index}" data-adjust="min">Min</button>
              <button class="quick-button" type="button" data-bet="${index}" data-adjust="max">Max</button>
            </div>
            <div class="auto-row">
              <label class="auto-control"><input id="autoEnabled${index}" type="checkbox"><span>Auto cash out</span></label>
              <label class="auto-input-wrap" aria-label="Auto cash out multiplier">
                <input class="auto-input" id="autoAt${index}" type="number" min="1.01" max="100" step="0.01" value="2.00"><span class="auto-x">x</span>
              </label>
            </div>
          </article>`;
      }

      function renderBetCards() {
        betGrid.innerHTML = bets.map((_, index) => betCardMarkup(index)).join("");
        bets.forEach((bet, index) => {
          const amountInput = $("amount" + index);
          const autoToggle = $("autoEnabled" + index);
          const autoAt = $("autoAt" + index);
          amountInput.addEventListener("input", () => {
            const amount = Number(amountInput.value);
            if (Number.isFinite(amount) && amount >= 0) bet.amount = amount;
          });
          amountInput.addEventListener("change", () => {
            const amount = Number(amountInput.value);
            bet.amount = Number.isFinite(amount) ? clamp(amount, 1, MAX_BET) : 1;
            amountInput.value = bet.amount.toFixed(2);
          });
          autoToggle.addEventListener("change", () => {
            bet.autoEnabled = autoToggle.checked;
            updateBetControls();
          });
          autoAt.addEventListener("change", () => {
            const target = Number(autoAt.value);
            bet.autoAt = Number.isFinite(target) ? clamp(target, 1.01, 100) : 2;
            autoAt.value = bet.autoAt.toFixed(2);
          });
          $("betAction" + index).addEventListener("click", () => onBetAction(index));
        });
        betGrid.addEventListener("click", (event) => {
          const button = event.target.closest("[data-bet]");
          if (!button) return;
          const index = Number(button.dataset.bet);
          adjustBet(index, button.dataset.adjust);
        });
        updateBetControls();
      }

      function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
      }

      function adjustBet(index, adjustment) {
        const bet = bets[index];
        if (!bet || bet.state === "active" || phase !== "waiting") return;
        if (adjustment === "min") bet.amount = 1;
        else if (adjustment === "max") bet.amount = Math.min(MAX_BET, balance);
        else bet.amount = Math.min(MAX_BET, (Number(bet.amount) || 0) + Number(adjustment));
        bet.amount = Math.round(bet.amount * 100) / 100;
        $("amount" + index).value = bet.amount.toFixed(2);
      }

      function onBetAction(index) {
        const bet = bets[index];
        if (phase === "waiting") {
          if (bet.state === "active") {
            cancelBet(index);
          } else {
            placeBet(index);
          }
          return;
        }
        if (phase === "flight" && bet.state === "active") cashOut(index, currentMultiplier, false);
      }

      function placeBet(index) {
        const bet = bets[index];
        const amount = Number($("amount" + index).value);
        if (!Number.isFinite(amount) || amount < 1 || amount > MAX_BET) {
          showToast("Enter a bet between PKR 1.00 and PKR 10,000.00.");
          return;
        }
        if (amount > balance) {
          showToast("Your demo balance is not enough for that bet.");
          return;
        }
        bet.amount = amount;
        bet.placedAmount = amount;
        bet.cashoutAt = null;
        bet.state = "active";
        balance -= amount;
        setBalance();
        updateBetControls();
        showToast(`Bet ${index + 1} placed for ${money(amount)}.`);
      }

      function cancelBet(index) {
        const bet = bets[index];
        balance += bet.placedAmount;
        bet.state = "idle";
        bet.placedAmount = 0;
        bet.cashoutAt = null;
        setBalance();
        updateBetControls();
        showToast(`Bet ${index + 1} cancelled.`);
      }

      function cashOut(index, multiplier, automatic) {
        const bet = bets[index];
        if (bet.state !== "active" || phase !== "flight") return;
        const targetMultiplier = Math.min(multiplier, crashMultiplier - 0.000001);
        if (targetMultiplier < 1) return;
        bet.cashoutAt = targetMultiplier;
        bet.state = "cashed";
        const payout = bet.placedAmount * targetMultiplier;
        const profit = payout - bet.placedAmount;
        balance += payout;
        setBalance();
        addMyHistory({
          round: roundNumber,
          betNumber: index + 1,
          amount: bet.placedAmount,
          at: targetMultiplier,
          profit,
          result: "cashed"
        });
        playSound("cashout");
        updateBetControls();
        showToast(`${automatic ? "Auto cash out" : "Cashed out"} at ${targetMultiplier.toFixed(2)}x · ${profit >= 0 ? "+" : ""}${money(profit)} profit`);
      }

      function updateBetControls() {
        bets.forEach((bet, index) => {
          const action = $("betAction" + index);
          const state = $("betState" + index);
          const amountInput = $("amount" + index);
          const autoToggle = $("autoEnabled" + index);
          const autoAt = $("autoAt" + index);
          const locked = bet.state === "active";
          amountInput.disabled = locked;
          autoToggle.disabled = locked;
          autoAt.disabled = locked;
          betGrid.querySelectorAll(`[data-bet="${index}"]`).forEach((button) => { button.disabled = locked || phase !== "waiting"; });
          state.className = "bet-state";
          if (bet.state === "active") {
            state.textContent = "Bet placed";
            state.classList.add("placed");
          } else if (bet.state === "cashed") {
            state.textContent = `Cashed ${bet.cashoutAt.toFixed(2)}x`;
            state.classList.add("cashed");
          } else if (bet.state === "lost") {
            state.textContent = "Flew away";
            state.classList.add("lost");
          } else {
            state.textContent = "Ready";
          }
          if (phase === "waiting") {
            action.textContent = locked ? "Cancel bet" : "Place bet";
            action.className = "bet-action " + (locked ? "" : "place");
            action.disabled = false;
          } else if (phase === "flight") {
            action.textContent = bet.state === "cashed" ? "Cashed out" : bet.state === "active" ? "Cash out" : "In flight";
            action.className = "bet-action " + (bet.state === "active" ? "cashout" : bet.state === "cashed" ? "success" : "");
            action.disabled = bet.state !== "active";
          } else {
            action.textContent = bet.state === "cashed" ? "Cashed out" : bet.state === "lost" ? "Lost" : "Next round";
            action.className = "bet-action " + (bet.state === "cashed" ? "success" : "");
            action.disabled = true;
          }
        });
      }

      function addMyHistory(item) {
        myHistory.unshift(item);
        myHistory.splice(50);
        renderMyHistory();
      }

      function renderMyHistory() {
        if (!myHistory.length) {
          myBetsEl.innerHTML = '<div class="empty-state">Your bets will appear here once you join a round.</div>';
          return;
        }
        myBetsEl.innerHTML = myHistory.map((item) => {
          const resultClass = item.result === "lost" ? "low" : item.profit >= 0 ? "purple" : "low";
          const result = `${item.profit >= 0 ? "+" : "−"}${money(Math.abs(item.profit))}`;
          const at = item.result === "lost" ? "—" : `${item.at.toFixed(2)}x`;
          return `<div class="my-row"><span class="player-name">#${item.round} · Bet ${item.betNumber}</span><span class="row-amount">${at}</span><span class="row-result ${resultClass}">${result}</span></div>`;
        }).join("");
      }

      function renderRoundHistory() {
        roundHistoryEl.innerHTML = roundHistory.length
          ? roundHistory.map((value) => {
            const category = value < 2 ? "low" : value <= 10 ? "mid" : "high";
            return `<span class="round-chip ${category}">${value.toFixed(2)}x</span>`;
          }).join("")
          : '<span class="round-chip">—</span>';
      }

      function fakeLiveBets() {
        lastLiveRefreshAt = performance.now();
        const count = 6 + Math.floor(Math.random() * 5);
        liveRows = Array.from({ length: count }, () => {
          const amount = [2, 5, 10, 20, 25, 50, 75, 100][Math.floor(Math.random() * 8)];
          const recentResult = roundHistory.length ? roundHistory[Math.floor(Math.random() * Math.min(roundHistory.length, 5))] : null;
          const result = phase === "flight" && Math.random() > .72
            ? Math.min(currentMultiplier, 1 + Math.random() * Math.max(.1, currentMultiplier - 1))
            : recentResult && Math.random() > .55 ? recentResult : null;
          return { name: botNames[Math.floor(Math.random() * botNames.length)] + (Math.random() > .7 ? Math.floor(Math.random() * 90) : ""), amount, result };
        });
        renderLiveBets();
      }

      function renderLiveBets() {
        liveBetsEl.innerHTML = liveRows.map((row) => {
          const result = row.result === null ? "—" : `${row.result.toFixed(2)}x`;
          const category = row.result === null ? "low" : row.result < 2 ? "low" : row.result <= 10 ? "purple" : "pink";
          return `<div class="live-row"><span class="player-name">${row.name}</span><span class="row-amount">${money(row.amount)}</span><span class="row-result ${category}">${result}</span></div>`;
        }).join("");
      }

      function updateStatus() {
        statusLine.className = "live-status" + (phase === "flight" ? " flight" : phase === "crashed" ? " crashed" : "");
        statusText.textContent = phase === "waiting" ? "Waiting for next round" : phase === "flight" ? "In progress" : "Crashed";
        $("roundId").textContent = `ROUND #${String(roundNumber).padStart(4, "0")}`;
      }

      function beginFlight(now) {
        phase = "flight";
        phaseStartedAt = now;
        flightElapsed = 0;
        currentMultiplier = 1;
        lastTickAt = now;
        particles = [];
        multiplierEl.classList.add("flight");
        messageEl.className = "game-message";
        messageEl.textContent = "Good luck — cash out any time";
        updateStatus();
        updateBetControls();
        playSound("takeoff");
        fakeLiveBets();
      }

      function crashRound(now) {
        phase = "crashed";
        phaseStartedAt = now;
        currentMultiplier = crashMultiplier;
        multiplierEl.textContent = crashMultiplier.toFixed(2) + "x";
        multiplierEl.classList.remove("flight");
        messageEl.className = "game-message crash";
        messageEl.textContent = "FLEW AWAY!";
        chartWrap.classList.remove("crash-flash");
        void chartWrap.offsetWidth;
        chartWrap.classList.add("crash-flash");
        roundHistory.unshift(crashMultiplier);
        roundHistory.splice(10);
        renderRoundHistory();
        bets.forEach((bet, index) => {
          if (bet.state === "active") {
            bet.state = "lost";
            bet.cashoutAt = null;
            addMyHistory({ round: roundNumber, betNumber: index + 1, amount: bet.placedAmount, at: null, profit: -bet.placedAmount, result: "lost" });
          }
        });
        updateStatus();
        updateBetControls();
        playSound("crash");
        fakeLiveBets();
      }

      function resetRound(now) {
        phase = "waiting";
        phaseStartedAt = now;
        currentMultiplier = 1;
        crashMultiplier = chooseCrashPoint();
        roundNumber += 1;
        bets.forEach((bet) => {
          if (bet.state === "cashed" || bet.state === "lost") {
            bet.state = "idle";
            bet.placedAmount = 0;
            bet.cashoutAt = null;
          }
        });
        multiplierEl.textContent = "1.00x";
        multiplierEl.classList.remove("flight");
        messageEl.className = "game-message";
        messageEl.innerHTML = '<span class="countdown" id="countdown">Starting in 5.0s</span>';
        updateStatus();
        updateBetControls();
        fakeLiveBets();
      }

      function updateGame(now) {
        if (phase === "waiting") {
          const remaining = Math.max(0, WAIT_MS - (now - phaseStartedAt));
          const countdown = $("countdown");
          if (countdown) countdown.textContent = `Starting in ${(remaining / 1000).toFixed(1)}s`;
          if (remaining <= 0) beginFlight(now);
        } else if (phase === "flight") {
          const elapsed = (now - phaseStartedAt) / 1000;
          flightElapsed = elapsed;
          const nextMultiplier = Math.exp(elapsed * .19);
          if (nextMultiplier >= crashMultiplier) {
            crashRound(now);
          } else {
            currentMultiplier = nextMultiplier;
            multiplierEl.textContent = currentMultiplier.toFixed(2) + "x";
            bets.forEach((bet, index) => {
              if (bet.state === "active" && bet.autoEnabled && bet.autoAt < crashMultiplier && currentMultiplier >= bet.autoAt) {
                cashOut(index, bet.autoAt, true);
              }
            });
            if (now - lastTickAt > 850) {
              playSound("tick");
              lastTickAt = now;
            }
            if (Math.random() < .65) {
              const point = getPlanePoint(currentMultiplier);
              particles.push({ x: point.x, y: point.y, life: 1, radius: 2 + Math.random() * 3 });
            }
            if (now - lastLiveRefreshAt > 3200) fakeLiveBets();
          }
        } else if (now - phaseStartedAt >= CRASH_PAUSE_MS) {
          resetRound(now);
        }
      }

      function chartCoordinates(multiplier) {
        const width = chartSize.width;
        const height = chartSize.height;
        const plotLeft = 44;
        const plotTop = 25;
        const plotBottom = height - 35;
        const plotRight = width - 25;
        const elapsed = phase === "flight"
          ? Math.max(0, (performance.now() - phaseStartedAt) / 1000)
          : phase === "crashed" ? flightElapsed : 0;
        const visibleSeconds = Math.max(10, Math.min(24, elapsed + 7));
        const xRatio = phase === "flight" || phase === "crashed" ? Math.min(.83, .14 + elapsed / visibleSeconds * .65) : .16;
        const logMultiplier = Math.log(Math.max(1, multiplier));
        const yRatio = Math.min(.8, logMultiplier / Math.log(100) * .8);
        return {
          x: plotLeft + (plotRight - plotLeft) * xRatio,
          y: plotBottom - (plotBottom - plotTop) * yRatio,
          plotLeft, plotRight, plotTop, plotBottom,
          elapsed, visibleSeconds
        };
      }

      function getPlanePoint(multiplier) {
        const point = chartCoordinates(multiplier);
        return { x: point.x, y: point.y };
      }

      function drawGrid(width, height, point) {
        const { plotLeft, plotRight, plotTop, plotBottom } = point;
        ctx.save();
        ctx.strokeStyle = "rgba(135, 155, 184, .09)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 7]);
        const yMarks = [1, 2, 5, 10];
        yMarks.forEach((value) => {
          const y = plotBottom - (plotBottom - plotTop) * (Math.log(value) / Math.log(100) * .8);
          ctx.beginPath(); ctx.moveTo(plotLeft, y); ctx.lineTo(plotRight, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(148,163,184,.48)";
          ctx.font = "10px system-ui";
          ctx.textAlign = "right";
          ctx.fillText(value + "x", plotLeft - 9, y + 3);
          ctx.setLineDash([3, 7]);
        });
        for (let i = 0; i <= 5; i += 1) {
          const x = plotLeft + (plotRight - plotLeft) * i / 5;
          ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBottom); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(148,163,184,.42)";
          ctx.font = "10px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(`${Math.round(point.visibleSeconds * i / 5)}s`, x, height - 13);
          ctx.setLineDash([3, 7]);
        }
        ctx.restore();
      }

      function drawPlane(x, y, angle, crashed, now) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(1.22, 1.22);

        const pulse = .8 + (Math.sin(now / 48) + 1) * .16;
        const metal = crashed ? "#ff9b65" : "#91aac8";
        ctx.shadowColor = crashed ? "rgba(255,73,108,.9)" : "rgba(84,174,255,.8)";
        ctx.shadowBlur = crashed ? 25 : 18;

        // Build the aircraft in layers so its swept wings read clearly at chart scale.
        ctx.fillStyle = crashed ? "#ba344e" : "#718ba9";
        ctx.beginPath();
        ctx.moveTo(6, -3);
        ctx.lineTo(-9, -7);
        ctx.lineTo(-33, -25);
        ctx.lineTo(-39, -25);
        ctx.lineTo(-28, -5);
        ctx.lineTo(-18, 1);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(6, 3);
        ctx.lineTo(-9, 7);
        ctx.lineTo(-33, 25);
        ctx.lineTo(-39, 25);
        ctx.lineTo(-28, 5);
        ctx.lineTo(-18, -1);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = crashed ? "#e94a61" : "#a9bfd8";
        ctx.beginPath();
        ctx.moveTo(-22, -3);
        ctx.lineTo(-34, -15);
        ctx.lineTo(-39, -15);
        ctx.lineTo(-35, -3);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-22, 3);
        ctx.lineTo(-34, 15);
        ctx.lineTo(-39, 15);
        ctx.lineTo(-35, 3);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-23, -2);
        ctx.lineTo(-34, -16);
        ctx.lineTo(-38, -16);
        ctx.lineTo(-34, -2);
        ctx.closePath();
        ctx.fill();

        [-10, 10].forEach((offset) => {
          ctx.fillStyle = crashed ? "#5c2634" : "#263b57";
          ctx.beginPath();
          ctx.ellipse(-15, offset, 7, 3.1, -.32, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = crashed ? "#ffab72" : "#75ddff";
          ctx.shadowColor = crashed ? "#ff663f" : "#45ccff";
          ctx.shadowBlur = 11 * pulse;
          ctx.beginPath();
          ctx.ellipse(-20, offset + .5, 2, 1.45, 0, 0, Math.PI * 2);
          ctx.fill();
        });

        const fuselage = crashed ? "#ff536c" : "#e7f3ff";
        ctx.shadowColor = crashed ? "rgba(255,73,108,.9)" : "rgba(84,174,255,.65)";
        ctx.shadowBlur = crashed ? 19 : 12;
        const bodyGradient = ctx.createLinearGradient(-8, -6, 4, 6);
        bodyGradient.addColorStop(0, "#ffffff");
        bodyGradient.addColorStop(.4, fuselage);
        bodyGradient.addColorStop(1, metal);
        ctx.fillStyle = bodyGradient;
        ctx.beginPath();
        ctx.moveTo(43, 0);
        ctx.quadraticCurveTo(38, -2.5, 26, -3.2);
        ctx.lineTo(-25, -5.6);
        ctx.quadraticCurveTo(-35, -5.2, -38, -2.2);
        ctx.lineTo(-38, 2.2);
        ctx.quadraticCurveTo(-35, 5.2, -25, 5.6);
        ctx.lineTo(26, 3.2);
        ctx.quadraticCurveTo(38, 2.5, 43, 0);
        ctx.closePath();
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = crashed ? "#552d41" : "#284e70";
        ctx.beginPath();
        ctx.moveTo(30, -.9);
        ctx.quadraticCurveTo(36, -1.3, 40, -.45);
        ctx.lineTo(34, .3);
        ctx.lineTo(29, .2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = crashed ? "rgba(255,236,221,.65)" : "rgba(255,255,255,.82)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-27, -2.7);
        ctx.quadraticCurveTo(2, -1.7, 29, -1.2);
        ctx.stroke();
        ctx.strokeStyle = crashed ? "#ffc18e" : "#ff5477";
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(-27, 2.5);
        ctx.quadraticCurveTo(0, 1.7, 25, .8);
        ctx.stroke();
        ctx.fillStyle = crashed ? "#602a3b" : "#5f7895";
        for (let i = 0; i < 4; i += 1) {
          ctx.beginPath();
          ctx.arc(13 - i * 6, -1.4, .65, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        const plumeLength = crashed ? 23 * pulse : 15 * pulse;
        const plume = ctx.createLinearGradient(-37, 0, -37 - plumeLength, 0);
        plume.addColorStop(0, crashed ? "rgba(255,86,75,.95)" : "rgba(118,224,255,.95)");
        plume.addColorStop(.45, crashed ? "rgba(255,163,75,.72)" : "rgba(120,154,255,.65)");
        plume.addColorStop(1, "rgba(255,116,151,0)");
        ctx.fillStyle = plume;
        ctx.beginPath();
        ctx.moveTo(-34, -1.6);
        ctx.quadraticCurveTo(-39 - plumeLength * .4, -2.1, -37 - plumeLength, 0);
        ctx.quadraticCurveTo(-39 - plumeLength * .4, 2.1, -34, 1.6);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = crashed ? .22 : .14;
        ctx.strokeStyle = "#d9edff";
        ctx.lineWidth = 1;
        [-3.5, 3.5].forEach((offset) => {
          ctx.beginPath();
          ctx.moveTo(-27, offset);
          ctx.quadraticCurveTo(-42, offset * 1.8 + Math.sin(now / 130) * 2, -55, offset * 2.1);
          ctx.stroke();
        });
        ctx.restore();
      }

      function drawChart(now) {
        const { width, height, dpr } = chartSize;
        if (!width || !height) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const point = chartCoordinates(currentMultiplier);
        drawGrid(width, height, point);

        const activeFlight = phase === "flight" || phase === "crashed";
        const pathEndX = activeFlight ? point.x : point.plotLeft + 20;
        const pathEndY = activeFlight ? point.y : point.plotBottom;
        const controlX = point.plotLeft + (pathEndX - point.plotLeft) * .56;
        const controlY = point.plotBottom - (point.plotBottom - pathEndY) * .08;

        if (activeFlight && pathEndX > point.plotLeft) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(point.plotLeft, point.plotBottom);
          ctx.quadraticCurveTo(controlX, controlY, pathEndX, pathEndY);
          ctx.lineTo(pathEndX, point.plotBottom);
          ctx.closePath();
          const fill = ctx.createLinearGradient(0, point.plotTop, 0, point.plotBottom);
          fill.addColorStop(0, "rgba(255,73,108,.17)");
          fill.addColorStop(1, "rgba(255,73,108,.005)");
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.restore();

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(point.plotLeft, point.plotBottom);
          ctx.quadraticCurveTo(controlX, controlY, pathEndX, pathEndY);
          ctx.strokeStyle = phase === "crashed" ? "#ff3e60" : "#ff5577";
          ctx.lineWidth = 3;
          ctx.shadowColor = "rgba(255,73,108,.75)";
          ctx.shadowBlur = 14;
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(point.plotLeft, point.plotBottom);
          ctx.lineTo(point.plotLeft + 30, point.plotBottom);
          ctx.strokeStyle = "rgba(255,85,119,.65)";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }

        particles = particles.filter((particle) => particle.life > 0);
        particles.forEach((particle) => {
          particle.life -= .025;
          particle.radius *= .99;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, ${85 + Math.floor(particle.life * 70)}, ${120 + Math.floor(particle.life * 50)}, ${particle.life * .55})`;
          ctx.fill();
        });

        if (phase === "flight") {
          drawPlane(point.x, point.y, -.42 - Math.min(.25, Math.log(currentMultiplier) * .05), false, now);
        } else if (phase === "crashed") {
          const crashAge = (now - phaseStartedAt) / 1000;
          drawPlane(point.x + Math.min(130, crashAge * 80), point.y - Math.min(110, crashAge * 70), -.55, true, now);
        } else {
          const idleX = point.plotLeft + 38 + Math.sin(now / 350) * 3;
          drawPlane(idleX, point.plotBottom - 5, -.18, false, now);
        }
      }

      function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        chartSize = { width: rect.width, height: rect.height, dpr };
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }

      function loop(now) {
        updateGame(now);
        drawChart(now);
        requestAnimationFrame(loop);
      }

      function switchTab(name) {
        const live = name === "live";
        $("liveTabButton").classList.toggle("active", live);
        $("myTabButton").classList.toggle("active", !live);
        $("liveTabButton").setAttribute("aria-selected", String(live));
        $("myTabButton").setAttribute("aria-selected", String(!live));
        $("liveTab").classList.toggle("active", live);
        $("myTab").classList.toggle("active", !live);
      }

      $("liveTabButton").addEventListener("click", () => switchTab("live"));
      $("myTabButton").addEventListener("click", () => switchTab("my"));
      $("soundToggle").addEventListener("click", () => {
        soundEnabled = !soundEnabled;
        updateSoundButton();
        if (soundEnabled) {
          audio();
          tone(620, .09, "sine", .025, 760);
        } else {
          Object.values(aircraftAudio).forEach((clip) => {
            clip.pause();
            clip.currentTime = 0;
          });
        }
      });
      window.addEventListener("resize", resizeCanvas, { passive: true });

      renderBetCards();
      setBalance();
      updateStatus();
      renderMyHistory();
      fakeLiveBets();
      resizeCanvas();
      requestAnimationFrame(loop);
    })();
