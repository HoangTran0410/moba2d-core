<script setup lang="ts">
/**
 * The screen a client gets when the host stops answering.
 *
 * Before this there was none, and that is the bug rather than a missing
 * nicety. `ClientSession.update()` drained its channel and drew whatever it
 * last knew; when the wire died it went on drawing that, confidently, for
 * ever. Reported exactly as it feels: *"đt nó tắt màn hình, trong thời gian đó
 * host bên máy kia vẫn chơi, giết t luôn, nhưng khi t mở màn hình lại thì
 * trạng thái đứng 1 chỗ, chưa chết"*. A stale world shown with no doubt is
 * worse than a black screen, because the player keeps issuing orders into a
 * match that stopped listening a minute ago.
 *
 * So: cover it, say so, and block input — the pointer-events are the point,
 * not the text.
 *
 * ## Reconnecting is a page load
 *
 * Not a second in-place resync. `ClientSession` is built from one `hello` and
 * `Game` is constructed from the same, so "re-sync what is already here" means
 * writing a second synchronisation path beside the first and keeping the two
 * agreeing for ever. Reloading re-runs the join that already exists, and the
 * seat in `localStorage` (`net/netSeat.ts`) is what makes the host hand back
 * the *same* champion — the gold, the bag, and the death that happened while
 * the phone was asleep — rather than a new one beside the old body.
 *
 * The URL already carries `?net=join&room=…`: it is how a match is armed, and
 * `disarmNetUrl()` strips it only on a deliberate exit. So a reload is the
 * whole reconnect.
 *
 * ## Why it counts down rather than hammering
 *
 * A host that is genuinely gone is the common case — somebody closed the tab —
 * and a client that reloads instantly, fails, and reloads instantly is a
 * device that never settles enough to show the player what happened. One
 * automatic attempt after a visible pause, then it is their call.
 */
import { onUnmounted, ref } from 'vue';
import { disarmNetUrl } from '@/scenes/lanSignal';
import { netLinkLost } from '@/game/net/netLink';

/** How long the player watches the notice before the automatic attempt. */
const AUTO_RETRY_SECONDS = 5;

const lost = netLinkLost;
const secondsLeft = ref(AUTO_RETRY_SECONDS);
const retrying = ref(false);
let ticking: ReturnType<typeof setInterval> | null = null;
/**
 * One automatic attempt per disconnection, not per mount. Reloading the page
 * ends this component's life anyway; the flag is for the case where the link
 * drops, comes back, and drops again inside one session.
 */
let autoTried = false;

const reconnect = (): void => {
  if (retrying.value) return;
  retrying.value = true;
  // `location.reload()` rather than assigning the same href: a reload re-runs
  // the join with the URL exactly as it stands, and the seat does the rest.
  location.reload();
};

const leave = (): void => {
  // Strip the arming parameters first, then reload into the menu.
  //
  // Not `MatchTab`'s `live.requestExit()`: that is the panel's own path and
  // this overlay has no source to reach it through — and more to the point,
  // the session it would tear down is the one that has already stopped
  // answering. A reload with `?net=`/`?room=` gone is the same destination by
  // the shortest road, and un-saying what the URL said is exactly what
  // `disarmNetUrl` exists for: without it the next press of Chơi silently
  // rejoins a room that is not there.
  disarmNetUrl();
  location.href = location.pathname + location.search;
};

/**
 * The countdown only exists while the overlay does, and only once per drop.
 * A `watch` on `lost` would be the tidier shape, but `netLink` is a plain
 * object read every frame rather than a `ref`, so `computed` is what actually
 * tracks it — and this arms off that.
 */
const arm = (): void => {
  if (ticking !== null || autoTried) return;
  secondsLeft.value = AUTO_RETRY_SECONDS;
  ticking = setInterval(() => {
    if (!lost.value) {
      // It came back on its own — a stall, not a death. Nothing to do, and
      // nothing was reloaded out from under the player.
      disarm();
      return;
    }
    secondsLeft.value -= 1;
    if (secondsLeft.value > 0) return;
    autoTried = true;
    disarm();
    reconnect();
  }, 1_000);
};

const disarm = (): void => {
  if (ticking === null) return;
  clearInterval(ticking);
  ticking = null;
};

onUnmounted(disarm);
</script>

<template>
  <div v-if="lost" id="net-link-lost" class="net-link-lost" role="alert" @vue:mounted="arm">
    <div class="net-link-box">
      <h2>Mất kết nối với chủ phòng</h2>
      <p>
        Trận đấu trên màn hình đã dừng cập nhật — những gì bạn thấy không còn
        đúng nữa.
      </p>
      <p v-if="!retrying" class="net-link-count">
        Tự động thử lại sau {{ secondsLeft }}s
      </p>
      <p v-else class="net-link-count">Đang kết nối lại…</p>
      <div class="net-link-actions">
        <button id="net-link-retry" type="button" class="hextech-btn" :disabled="retrying"
          @click="reconnect" @touchend.prevent="reconnect">
          Thử lại ngay
        </button>
        <button id="net-link-leave" type="button" class="ghost" @click="leave"
          @touchend.prevent="leave">
          Thoát trận
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * `pointer-events: auto` on a full-screen fixed layer is the working part of
 * this component: every order the player issues from here would otherwise go
 * into a match that is not listening.
 */
.net-link-lost {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  background: rgba(2, 6, 14, 0.88);
  }

.net-link-box {
  max-width: min(92vw, 30rem);
  padding: 1.25rem 1.5rem;
  border: 1px solid rgba(200, 155, 60, 0.55);
  border-radius: 0.5rem;
  background: #0a1220;
  color: #e8e3d5;
  text-align: center;
}

.net-link-box h2 {
  margin: 0 0 0.5rem;
  font-size: 1.15rem;
  color: #d8b45a;
}

.net-link-box p {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  line-height: 1.45;
}

.net-link-count {
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.net-link-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 0.9rem;
}

.net-link-actions .ghost {
  background: none;
  border: 1px solid rgba(232, 227, 213, 0.3);
  border-radius: 0.35rem;
  color: #e8e3d5;
  padding: 0.4rem 0.8rem;
}

/* A landscape phone is 390px tall: the box must not need the page to scroll. */
@media (max-height: 430px) {
  .net-link-box {
    padding: 0.75rem 1rem;
  }

  .net-link-box p {
    font-size: 0.8rem;
  }
}
</style>
