<script setup lang="ts">
/**
 * The About screen's content: what the game is, how to give it content, a
 * link to the source, any write-ups about the project, and a player-facing
 * changelog.
 *
 * One scrollable panel rather than a tabbed one (contrast
 * `MatchConfigPanel.vue`): three short, read-only sections fit a single
 * scroll without needing per-section state to survive a re-mount, so a tab
 * bar here would only add a click between them for no control gained.
 *
 * `CHANGELOG` (`./about/changelog.ts`) and `ARTICLES` (`./about/articles.ts`)
 * are plain data — no `src/game/` import, see their own file comments and
 * `tests/scenes/aboutBootPath.test.ts` — and are the two files meant to be
 * edited directly, including by someone who does not read the rest of this
 * component.
 *
 * No hand-rolled touch scrolling here, unlike `MatchConfigPanel`'s tabs: that
 * machinery exists because the practice panel is also mounted *inside*
 * `#game-scene`, under `touch-action: none` (see `styles/game-scene.css`),
 * where a plain scroll container fights the canvas for the gesture. This
 * screen mounts over `#about-scene`, a sibling of `#game-scene` reached only
 * from the menu — no p5 canvas exists yet, `GameScene.syncTouches` only ever
 * claims touches whose target *is* that canvas (see its own comment), and
 * `body { overflow: hidden }` is the only ancestor rule in play. Plain
 * `overflow-y: auto` on `.about-body` is therefore the whole of the fix.
 */
import { CHANGELOG } from './about/changelog';
import { ARTICLES } from './about/articles';

const emit = defineEmits<{ close: []; openPacks: [] }>();

/**
 * This repository, not the one the project started in. `HoangTran0410/LOL2D`
 * is where it lived before the engine and its content were split apart, and
 * a link to a repository that is no longer the one being played is worse
 * than no link at all — see `README.md`, which carried the same stale URL.
 */
const REPO_URL = 'https://github.com/HoangTran0410/moba2d-core';
</script>

<template>
  <div class="about-panel">
    <header class="about-header">
      <h1>Giới thiệu</h1>
      <button
        type="button"
        class="about-close"
        id="about-close"
        title="Quay lại"
        @click="emit('close')"
      >
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
      </button>
    </header>

    <div class="about-body">
      <section class="about-section about-intro">
        <p class="about-intro-text">
          <strong>MOBA2D</strong> là một game MOBA 2D chạy thẳng trên trình duyệt. Chọn tướng, ghép
          chiêu thức, chia phe Xanh/Đỏ, cày lính, đẩy đường và hạ trụ — trên điện thoại hay máy
          tính, không cần cài thêm gì ngoài trình duyệt.
        </p>
        <p class="about-intro-text">
          Game không đi kèm sẵn tướng nào. Tướng, chiêu, quái rừng và bản đồ đều nằm trong
          <strong>pack nội dung</strong> mà game tải lúc chạy — xem mục dưới.
        </p>
        <div class="about-link-row">
          <a
            class="hextech-btn secondary about-link"
            :href="REPO_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            <i class="fab fa-github" aria-hidden="true"></i> Xem mã nguồn trên GitHub
          </a>
        </div>
      </section>

      <section class="about-section about-packs">
        <h2>Cài thêm nội dung</h2>
        <p class="about-packs-text">
          Mở màn <strong>Nội dung / Pack</strong> (ngay dưới nút Chơi ở menu) để xem pack đang cài,
          gỡ bớt, hoặc thêm pack mới. Pack có sẵn thì bấm <strong>Cài</strong> là xong; pack ở nơi
          khác thì dán link <code>manifest.json</code> của nó vào ô Thêm bằng URL rồi bấm
          <strong>Kiểm tra</strong>. Cài xong dùng được ngay, không phải tải lại trang.
        </p>
        <p class="about-packs-text">
          Pack mặc định do cộng đồng làm, không liên kết với hãng game nào. Bản thân game không
          thuộc về pack nào — gỡ nó ra thì game vẫn chạy, chỉ là còn đúng một tướng.
        </p>
        <p class="about-packs-warning">
          Trước khi cài, game hiện <strong>tên miền</strong> của pack. Đó là dòng đáng đọc kỹ nhất
          trên màn hình đó: một pack chạy với toàn quyền trên trang này — đọc và sửa được cấu hình,
          giao diện và dữ liệu của bạn. Chỉ cài từ nguồn bạn tin.
        </p>
        <div class="about-link-row">
          <button
            type="button"
            id="about-open-packs"
            class="hextech-btn secondary about-link"
            @click="emit('openPacks')"
            @touchend.prevent="emit('openPacks')"
          >
            <i class="fas fa-cubes" aria-hidden="true"></i> Mở màn Nội dung / Pack
          </button>
        </div>
      </section>

      <section class="about-section about-articles">
        <h2>Bài viết</h2>
        <ul v-if="ARTICLES.length" class="about-article-list">
          <li v-for="article in ARTICLES" :key="article.url" class="about-article">
            <a
              class="about-article-title"
              :href="article.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ article.title }}
            </a>
            <p class="about-article-desc">{{ article.description }}</p>
          </li>
        </ul>
        <p v-else class="about-empty">Chưa có bài viết nào ở đây.</p>
      </section>

      <section class="about-section about-changelog">
        <h2>Có gì mới</h2>
        <article
          v-for="release in CHANGELOG"
          :key="release.date + release.title"
          class="about-release"
        >
          <h3 class="about-release-title">
            {{ release.title }}
            <span class="about-release-date">{{ release.date }}</span>
          </h3>
          <ul class="about-release-list">
            <li v-for="item in release.highlights" :key="item">{{ item }}</li>
          </ul>
        </article>
      </section>
    </div>
  </div>
</template>
