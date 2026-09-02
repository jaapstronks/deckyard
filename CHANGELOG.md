# Changelog

Notable changes to Deckyard. The format follows
[Keep a Changelog](https://keepachangelog.com/); given the project's pace,
entries are grouped per release rather than exhaustively listed.

## [1.29.0](https://github.com/jaapstronks/deckyard/compare/v1.28.0...v1.29.0) (2026-09-02)


### ⚠ BREAKING CHANGES

* **slide-types:** the slide-type root CSS classes `.slide-title-universal` (title-slide) and `.slide-lijstje` (list-slide) are renamed to `.slide-title` and `.slide-list`. Deckyard's own stylesheets move with them, so core themes are unaffected; a fork that styles either name against its own copy of the slide types must rename the rule. The `tsu-*` and `.lijst*` families are unchanged.
* **slide-types:** the slide-type CSS class `.sfi-card-kicker` is renamed to `.sfi-card-title` (feedback-slide, follow-invite-slide). Deckyard's own stylesheet moves with it, so core themes are unaffected; a fork that styles this name against its own copy of the slide types must rename the rule.

### Added

* **capture:** a second take, and the frame ticker that makes takes trustworthy ([#1051](https://github.com/jaapstronks/deckyard/issues/1051)) ([3106ac2](https://github.com/jaapstronks/deckyard/commit/3106ac23a2139744d8f511709fc9577fee3406b6))
* **capture:** record video takes from the recipe format that already exists ([#1039](https://github.com/jaapstronks/deckyard/issues/1039)) ([86151ef](https://github.com/jaapstronks/deckyard/commit/86151efffa4f6507f60ad3656111dbf558dafb5b))
* **capture:** report a run as JSON, and measure what two runs agree on ([#1058](https://github.com/jaapstronks/deckyard/issues/1058)) ([a5acc7d](https://github.com/jaapstronks/deckyard/commit/a5acc7d0a0c8c77addec172b589815ec61de8036))
* **feedback:** the kind of event decides the carrier, and a refusal is inline ([df04a27](https://github.com/jaapstronks/deckyard/commit/df04a278ba588d69f4f3c4d5a0b3e6825b72754f))
* **i18n:** derive translation progress per language ([#1064](https://github.com/jaapstronks/deckyard/issues/1064)) ([9312df7](https://github.com/jaapstronks/deckyard/commit/9312df72606b2a418052dd35647d34531e4c2c0d))
* **i18n:** gate anchor consistency — one concept, one word per locale (B148) ([#1012](https://github.com/jaapstronks/deckyard/issues/1012)) ([f368b05](https://github.com/jaapstronks/deckyard/commit/f368b0512fcf8a222ac17f7aca4cdce9266cd10b))
* **i18n:** move a deck's source version from the language menu ([#1069](https://github.com/jaapstronks/deckyard/issues/1069)) ([05ef28d](https://github.com/jaapstronks/deckyard/commit/05ef28d2f02915d31ee4f0c98e12ec31cb9a077e))
* **i18n:** one language menu per deck in the editor topbar ([#1065](https://github.com/jaapstronks/deckyard/issues/1065)) ([2f5fee5](https://github.com/jaapstronks/deckyard/commit/2f5fee593539310afcadd2e30665ebe09576f7ff))
* **i18n:** the deck-language axis becomes one open list ([#1026](https://github.com/jaapstronks/deckyard/issues/1026)) ([62c5bae](https://github.com/jaapstronks/deckyard/commit/62c5bae42561d9e036585573276949d827c74659))
* **i18n:** the deck's source version stays put while you edit a translation ([#1066](https://github.com/jaapstronks/deckyard/issues/1066)) ([5b17450](https://github.com/jaapstronks/deckyard/commit/5b174504260621fad5c0b992a232a6caee51cd30))
* **i18n:** the translate modals name their source and target off the axis ([#1071](https://github.com/jaapstronks/deckyard/issues/1071)) ([078576c](https://github.com/jaapstronks/deckyard/commit/078576cb8a5f07603e4e42c41017f2d7795034cf))
* **lint:** make lint:deadcss a gate behind a reasoned allowlist ([#1052](https://github.com/jaapstronks/deckyard/issues/1052)) ([63c5a90](https://github.com/jaapstronks/deckyard/commit/63c5a90804eaaa239d8a0ed710732f1375394637))
* **list:** content-addressed deck thumbnails and one deck-card mapper ([#1036](https://github.com/jaapstronks/deckyard/issues/1036)) ([ffae871](https://github.com/jaapstronks/deckyard/commit/ffae871731eae217f548959ea39586062969b03b))
* **slide-types:** a shared partials library for eyebrows, badges and highlights ([8255509](https://github.com/jaapstronks/deckyard/commit/8255509f6bec3fe5299e07881f990c78678dd61b))
* **slide-types:** add callout-slide, the admonition family ([#1028](https://github.com/jaapstronks/deckyard/issues/1028)) ([5b88fd7](https://github.com/jaapstronks/deckyard/commit/5b88fd786e9e6cad74fb2440c9df16b9980cae43))
* **slide-types:** aside insets — the within-slide contrast block ([#1032](https://github.com/jaapstronks/deckyard/issues/1032)) ([9ffb0d9](https://github.com/jaapstronks/deckyard/commit/9ffb0d964d3703dc40ea89b9f45963f624f8818d))
* **slide-types:** comparison sub-variants — versus, before-after, pros-cons, tradeoff ([#1031](https://github.com/jaapstronks/deckyard/issues/1031)) ([0501c91](https://github.com/jaapstronks/deckyard/commit/0501c915ba05ed275e0da7fc5cde20f4734464f7))
* **slide-types:** give the title slide its own type step (5xl) ([#1067](https://github.com/jaapstronks/deckyard/issues/1067)) ([0a6b3bf](https://github.com/jaapstronks/deckyard/commit/0a6b3bfd337e74900dbe37a6c83040cfd5701230))
* **slide-types:** the CSS-scoping convention for file-JS types ([#1030](https://github.com/jaapstronks/deckyard/issues/1030)) ([54c8f32](https://github.com/jaapstronks/deckyard/commit/54c8f3253ba983d5dcdabfd83eff68de0387767b))
* **slide-types:** validate custom slide-type definitions, and scaffold valid ones ([#1027](https://github.com/jaapstronks/deckyard/issues/1027)) ([828e618](https://github.com/jaapstronks/deckyard/commit/828e618cdc1d4c08ab75a360417bcc002e819659))
* the viewer chrome and follow codes follow the deck's versions ([2b2e810](https://github.com/jaapstronks/deckyard/commit/2b2e81061035974e7c70e3d3d3b0f406cdf3999a))


### Fixed

* **api:** 403 for authenticated-but-forbidden callers (D68) ([#1010](https://github.com/jaapstronks/deckyard/issues/1010)) ([bf26dc3](https://github.com/jaapstronks/deckyard/commit/bf26dc3d0b29c9b17826f49a549fc0f069373757))
* **capture:** pin the join code so marketing shots reproduce ([#1062](https://github.com/jaapstronks/deckyard/issues/1062)) ([43ed260](https://github.com/jaapstronks/deckyard/commit/43ed260a4417cd7d4b1a2afec73149a399a1c3c8))
* **capture:** seed comment threads through a storage scope ([#1056](https://github.com/jaapstronks/deckyard/issues/1056)) ([c343d08](https://github.com/jaapstronks/deckyard/commit/c343d089c3a6aeb29895a98f28123a59dc7e4d96))
* **chart-slide:** drop the orphan `subtitle` default and gate the shape ([1941bee](https://github.com/jaapstronks/deckyard/commit/1941bee9bf157ac382f7a52b4f824cb5a355e4f1))
* **css:** key per-type dark-ground rules on luminance, not name (B165) ([#1015](https://github.com/jaapstronks/deckyard/issues/1015)) ([25d2b1c](https://github.com/jaapstronks/deckyard/commit/25d2b1c0a92a28e6c46ac38eee488fedaeba506f))
* **email:** escape once, and cover recipient/template/locale (B151) ([#1019](https://github.com/jaapstronks/deckyard/issues/1019)) ([4d0f0ea](https://github.com/jaapstronks/deckyard/commit/4d0f0ea80422aec19d1f42bfc1c85f924a317547))
* **embed:** the boot payload parses again - the JSON went through escapeHtml() into a raw-text script block, so every embed since 1.0.0 ran on defaults. Slide count, language switch, start/loop/ui and a configured allowedOrigins list now take effect (an empty list still allows all origins). ([2b2e810](https://github.com/jaapstronks/deckyard/commit/2b2e81061035974e7c70e3d3d3b0f406cdf3999a))
* **fork:** give the gates fork seams and split the font lock (B163) ([4898191](https://github.com/jaapstronks/deckyard/commit/48981915d9c02d46a98599535617d1cbb27b053d))
* **i18n:** resolve the B148 anchor decision round (cohorts 1-2) ([#1013](https://github.com/jaapstronks/deckyard/issues/1013)) ([1674059](https://github.com/jaapstronks/deckyard/commit/167405978bd5a91206d05b1ecb4f1eda66023331))
* **i18n:** translate nested item texts (rows[].blocks[]) (B164) ([7e5e5e3](https://github.com/jaapstronks/deckyard/commit/7e5e5e3633256ffa0fe249ef514ef1b70f9e2f0c))
* **lint:** a composed CSS class must be assemblable, not merely prefixed ([b652399](https://github.com/jaapstronks/deckyard/commit/b65239926c0839bcabbc018654a42581fd78bece))
* **lint:** extend the silent-failure gate to shared/ and clear its burndown ([#1008](https://github.com/jaapstronks/deckyard/issues/1008)) ([566befb](https://github.com/jaapstronks/deckyard/commit/566befbe79205017cd632d7b6edfaf7c064cfb65))
* **list:** make deck-card thumbnails actually load ([#1034](https://github.com/jaapstronks/deckyard/issues/1034)) ([ff55d36](https://github.com/jaapstronks/deckyard/commit/ff55d36120cc71194963b522894745f36b74986f))
* **mcp:** scope an SSE call to the organization of its API key ([7fc6c6a](https://github.com/jaapstronks/deckyard/commit/7fc6c6ae0c2acf984c4840fe63c229549f508b47))
* **presenter:** render the console's next-slide thumb in the deck language ([#1033](https://github.com/jaapstronks/deckyard/issues/1033)) ([a414e6d](https://github.com/jaapstronks/deckyard/commit/a414e6d365998968ec9434b7c30a921256d869d6))
* **render:** every slide-mount call site states its deck language ([#1035](https://github.com/jaapstronks/deckyard/issues/1035)) ([3c000b0](https://github.com/jaapstronks/deckyard/commit/3c000b08194ebe295a0160d957f0ad57941a99b8))
* **slide-types:** a refused save says which field, next to the button ([#1072](https://github.com/jaapstronks/deckyard/issues/1072)) ([6835ca0](https://github.com/jaapstronks/deckyard/commit/6835ca08409881e28a0acc683bdc5900d997367c))
* **slide-types:** fold legacy `subtitle` in the migration funnel, drop its readers ([#1055](https://github.com/jaapstronks/deckyard/issues/1055)) ([9c59693](https://github.com/jaapstronks/deckyard/commit/9c59693df6d58c7c80297db59b67d43d6869a923))
* **slide-types:** give title-slide and list-slide their convention root class ([857868d](https://github.com/jaapstronks/deckyard/commit/857868ddbefd8a49033a1f8e24a19baf3c172936))
* **slide-types:** rename `.sfi-card-kicker` to `.sfi-card-title` ([#1060](https://github.com/jaapstronks/deckyard/issues/1060)) ([19153fc](https://github.com/jaapstronks/deckyard/commit/19153fc39e9bd2c6b7a13934f8bd3b914d0ac558))
* **slide-types:** scope a DB slide type's CSS to its own root ([#1063](https://github.com/jaapstronks/deckyard/issues/1063)) ([8de1cdb](https://github.com/jaapstronks/deckyard/commit/8de1cdbd73c2785024aa7f044aa6a50cf8e36873))
* **slide-types:** the cover steps down when its text will not fit ([#1068](https://github.com/jaapstronks/deckyard/issues/1068)) ([1ca4812](https://github.com/jaapstronks/deckyard/commit/1ca48123c9aa8f8e0ae018105672eb01481059ca))
* **toast:** a failure announces as a failure, and Escape closes it ([#1073](https://github.com/jaapstronks/deckyard/issues/1073)) ([7b713fe](https://github.com/jaapstronks/deckyard/commit/7b713fe62b469325afc3201dcf3fc6b50572d8a6))


### Security

* **mcp:** gate tool calls on API-key permissions and quota ([#1024](https://github.com/jaapstronks/deckyard/issues/1024)) ([5d22d5a](https://github.com/jaapstronks/deckyard/commit/5d22d5a34924540c9d3d3dc31821c8a15bb3f154))


### Changed

* keep the next release in 1.x per the beta rule ([546ff61](https://github.com/jaapstronks/deckyard/commit/546ff61153c561b168d5de1afbade113bc1161bf))

## [1.28.0](https://github.com/jaapstronks/deckyard/compare/v1.27.2...v1.28.0) (2026-08-26)


### Added

* **themes:** a theme:preview contact sheet for every slide type (B162) ([#1002](https://github.com/jaapstronks/deckyard/issues/1002)) ([8b08af7](https://github.com/jaapstronks/deckyard/commit/8b08af746d1bd204da270980b6d3380ad8ef657c))


### Fixed

* **i18n:** carry the D66 terminology decisions into the locales ([#1005](https://github.com/jaapstronks/deckyard/issues/1005)) ([9565a3a](https://github.com/jaapstronks/deckyard/commit/9565a3abdfd5309e46dc306782dde06ec8f766d4))
* **scripts:** migrate legacy backgrounds on Postgres and in language versions (B175) ([#1000](https://github.com/jaapstronks/deckyard/issues/1000)) ([22cba7a](https://github.com/jaapstronks/deckyard/commit/22cba7a6907270466c12a02e2e7f74a086f6e222))

## [1.27.2](https://github.com/jaapstronks/deckyard/compare/v1.27.1...v1.27.2) (2026-08-26)


### Fixed

* **editor:** refresh the images selection list in place, not by redraw (B169) ([#997](https://github.com/jaapstronks/deckyard/issues/997)) ([7013aa5](https://github.com/jaapstronks/deckyard/commit/7013aa530caecc5b5e666e860417138920aef5ba))
* **i18n:** one English per key between the registry and en/ (B174) ([#996](https://github.com/jaapstronks/deckyard/issues/996)) ([ba7c5c6](https://github.com/jaapstronks/deckyard/commit/ba7c5c617b68d0a7abf3b999ac4013d1f15eac4c))
* **themes:** enforce the enabledThemes allowlist in every picker (B176) ([#999](https://github.com/jaapstronks/deckyard/issues/999)) ([58c4e21](https://github.com/jaapstronks/deckyard/commit/58c4e2160d43147c16990c12f54e5d02d48577c4))

## [1.27.1](https://github.com/jaapstronks/deckyard/compare/v1.27.0...v1.27.1) (2026-08-26)


### Fixed

* **collab:** stop collapsing hidden prose mirrors to one language ([#986](https://github.com/jaapstronks/deckyard/issues/986)) ([0373682](https://github.com/jaapstronks/deckyard/commit/0373682218ebc7647cdc57f79dbefb593442e4c3))
* **editor:** one background-image control per slide, for every type ([#981](https://github.com/jaapstronks/deckyard/issues/981)) ([38a8094](https://github.com/jaapstronks/deckyard/commit/38a80947f2f05e48d550d0ae12e93c545e15bf77))
* **i18n:** gate the keys slide-type declarations own (B168) ([5e1104d](https://github.com/jaapstronks/deckyard/commit/5e1104d7ebcb50f2f6bc64fe96512e66f3000538))
* **i18n:** give every type-independent slide field one shared key (B146) ([#991](https://github.com/jaapstronks/deckyard/issues/991)) ([8b49611](https://github.com/jaapstronks/deckyard/commit/8b4961187f558c1d434a7ef224ffd1a40256d989))
* **i18n:** stop minting machine tokens as translatable option copy (B145) ([#985](https://github.com/jaapstronks/deckyard/issues/985)) ([60d8aa3](https://github.com/jaapstronks/deckyard/commit/60d8aa39cac38ec0532d469efe945036b2d10522))
* **i18n:** translate the 154 untranslated slideType.* keys in nl/ (B173) ([6d2df53](https://github.com/jaapstronks/deckyard/commit/6d2df539e3ca329a90928a65deb4ec0dcb6674e6))
* **i18n:** translate the 18 unfilled shared slide-field keys (B166) ([14341b3](https://github.com/jaapstronks/deckyard/commit/14341b3fe6f6da1375bd9c8932b0b22676c6c09e))
* **i18n:** translate the 66 new option labels in the eleven fill locales (B158) ([cdb4f65](https://github.com/jaapstronks/deckyard/commit/cdb4f65427c2911427fe11eb5fd1ab547d48d49e))
* **themes:** let a background variant declare how dark its ground is (B159) ([#989](https://github.com/jaapstronks/deckyard/issues/989)) ([4aeaef6](https://github.com/jaapstronks/deckyard/commit/4aeaef678ce27954aa9c7cb47c43a928a4fbc8e7))


### Security

* **export:** let a theme variant's artwork reach PDF, and stop its URL reaching Chrome ([#988](https://github.com/jaapstronks/deckyard/issues/988)) ([41924d9](https://github.com/jaapstronks/deckyard/commit/41924d9847f9fa613156cb3fc44ae175500a9a75))

## [1.27.0](https://github.com/jaapstronks/deckyard/compare/v1.26.0...v1.27.0) (2026-08-24)


### ⚠ BREAKING CHANGES

* **i18n:** one flag vocabulary across the i18n scripts (B147) ([#976](https://github.com/jaapstronks/deckyard/issues/976))
* **i18n:** retire i18n-validate.js — every check it made is a test (B147) ([#975](https://github.com/jaapstronks/deckyard/issues/975))

### Fixed

* **api:** one pagination parser, so ?limit=abc no longer empties the page (B143) ([#964](https://github.com/jaapstronks/deckyard/issues/964)) ([7aef42f](https://github.com/jaapstronks/deckyard/commit/7aef42fdf94d4927647cb02ce98804b22fc6c839))
* **client:** gate the ten admin affordances on the active workspace (B144) ([#965](https://github.com/jaapstronks/deckyard/issues/965)) ([f9e9c8b](https://github.com/jaapstronks/deckyard/commit/f9e9c8b53a65a27af7397d36f01b2cf9fb5ff005))
* **client:** one owner for the audience-question surface, so all three Q&A views read the same field (B153) ([#966](https://github.com/jaapstronks/deckyard/issues/966)) ([a0c79a8](https://github.com/jaapstronks/deckyard/commit/a0c79a8ba7aff8e63d9f6632b0eff48ed17eb601))
* **i18n:** make en/ a superset of every locale, and fill the 62 keys nl/ had alone (B138) ([#958](https://github.com/jaapstronks/deckyard/issues/958)) ([166a35b](https://github.com/jaapstronks/deckyard/commit/166a35bb617f00084811fff2dcdfba97aaa909de))
* **i18n:** one shared editor.slideField.* key per global slide field (B140) ([aa85870](https://github.com/jaapstronks/deckyard/commit/aa85870536f04b38d6dfaa88b809385403c875c1))
* **i18n:** sweep the copy nits the B133 review left in six locales ([#959](https://github.com/jaapstronks/deckyard/issues/959)) ([8ba5871](https://github.com/jaapstronks/deckyard/commit/8ba5871cc6b07435101d0e7a3f2e8434a5d536b3))
* **i18n:** translate the 29 editor.slideField.* keys into the ten fill-locales (B141) ([#963](https://github.com/jaapstronks/deckyard/issues/963)) ([1c10686](https://github.com/jaapstronks/deckyard/commit/1c10686cda970630c609a1c56f5f1f619a509cb3))
* **i18n:** translate the 60 B138 keys into the ten fill-locales (B139) ([a92cce1](https://github.com/jaapstronks/deckyard/commit/a92cce1ae5d92de5f4ce660cf168106f1579bf48))


### Security

* **authz:** scope the five admin bypasses to the active organization ([#970](https://github.com/jaapstronks/deckyard/issues/970)) ([80d2638](https://github.com/jaapstronks/deckyard/commit/80d26384669e87503fbc725742dfca4bb5c14205))
* **settings:** render the email-template preview in a sandboxed frame (B154) ([#967](https://github.com/jaapstronks/deckyard/issues/967)) ([0f98a51](https://github.com/jaapstronks/deckyard/commit/0f98a513d63e34e037afe71bb2b2863f78d9ba9d))


### Changed

* **i18n:** one flag vocabulary across the i18n scripts (B147) ([#976](https://github.com/jaapstronks/deckyard/issues/976)) ([bbb3ec3](https://github.com/jaapstronks/deckyard/commit/bbb3ec35076866c5513263aff8844ab06634015c))
* **i18n:** retire i18n-validate.js — every check it made is a test (B147) ([#975](https://github.com/jaapstronks/deckyard/issues/975)) ([b5dfe61](https://github.com/jaapstronks/deckyard/commit/b5dfe61f751fde97738dbcf2b92da38af645f30d))
* pin the next release to 1.27.0 while the beta badge is up ([d223025](https://github.com/jaapstronks/deckyard/commit/d223025c6283c2de4964d2a26d6e6a9a71a5014a))

## [1.26.0](https://github.com/jaapstronks/deckyard/compare/v1.25.0...v1.26.0) (2026-08-24)


### Added

* **i18n:** give i18n-sync a --dry-run and retire the unread index.json ([#943](https://github.com/jaapstronks/deckyard/issues/943)) ([69c7c74](https://github.com/jaapstronks/deckyard/commit/69c7c744929c44bc1210d7e8ac066ee0ba41b8a2))
* **reader:** project tabular and dataset slides per their structure contract ([#933](https://github.com/jaapstronks/deckyard/issues/933)) ([324a77f](https://github.com/jaapstronks/deckyard/commit/324a77f53cb568ed567850f673bbad14b3ecb868))
* **reader:** stop projecting configuration and duplicated alt text as prose ([#936](https://github.com/jaapstronks/deckyard/issues/936)) ([3267d93](https://github.com/jaapstronks/deckyard/commit/3267d930a05f637e027d7f647bab09d52c6d0c7b))
* **slide-types:** fold poll and likert options into one array (schema v8 → v9) ([#939](https://github.com/jaapstronks/deckyard/issues/939)) ([b55270a](https://github.com/jaapstronks/deckyard/commit/b55270ab0f86b3859027808319b01c579851fa9a))


### Fixed

* **editor:** finish the `images` field as an extension point, drop its dead alt path (B126) ([#941](https://github.com/jaapstronks/deckyard/issues/941)) ([1d4f6bb](https://github.com/jaapstronks/deckyard/commit/1d4f6bb9f8fafb4822b8914a6660e02c515d95dd))
* **i18n:** complete the Danish translation (B133 8/11) ([#953](https://github.com/jaapstronks/deckyard/issues/953)) ([731bcc4](https://github.com/jaapstronks/deckyard/commit/731bcc4a8fe5be8f2d0f4c97347f6dfb530d24f3))
* **i18n:** complete the Finnish translation (B133 7/11) ([#952](https://github.com/jaapstronks/deckyard/issues/952)) ([73e2129](https://github.com/jaapstronks/deckyard/commit/73e21293431619a05050affecbf78f27ba09a6e9))
* **i18n:** complete the French translation (B133 2/11) ([#947](https://github.com/jaapstronks/deckyard/issues/947)) ([89e7774](https://github.com/jaapstronks/deckyard/commit/89e77748c8b40c131591aafad0577cad3de829b5))
* **i18n:** complete the German translation (B133 1/11) ([#946](https://github.com/jaapstronks/deckyard/issues/946)) ([1a21dbd](https://github.com/jaapstronks/deckyard/commit/1a21dbd129436a3e3ffcb81767d2617f0af7dad4))
* **i18n:** complete the Italian translation (B133 5/11) ([#950](https://github.com/jaapstronks/deckyard/issues/950)) ([bbb3014](https://github.com/jaapstronks/deckyard/commit/bbb301413307a87afaacea85a03d01373745f322))
* **i18n:** complete the Norwegian translation (B133 10/11) ([#955](https://github.com/jaapstronks/deckyard/issues/955)) ([b4a4d64](https://github.com/jaapstronks/deckyard/commit/b4a4d6409aac6f32858a26531aaae0928b72f1fe))
* **i18n:** complete the Polish translation (B133 6/11) ([#951](https://github.com/jaapstronks/deckyard/issues/951)) ([a7f14ac](https://github.com/jaapstronks/deckyard/commit/a7f14accbfe69bab8f6bdb5ac004a0f0ba36620e))
* **i18n:** complete the Portuguese translation (B133 4/11) ([#949](https://github.com/jaapstronks/deckyard/issues/949)) ([0d4e3a4](https://github.com/jaapstronks/deckyard/commit/0d4e3a4e2afe83cdeb1a249c95fa5a16eba7ecb8))
* **i18n:** complete the Spanish translation (B133 3/11) ([#948](https://github.com/jaapstronks/deckyard/issues/948)) ([6edf536](https://github.com/jaapstronks/deckyard/commit/6edf53687e75571a44efe5741fc29dc3d78879c3))
* **i18n:** complete the Swedish translation (B133 9/11) ([#954](https://github.com/jaapstronks/deckyard/issues/954)) ([296bd47](https://github.com/jaapstronks/deckyard/commit/296bd478a85628b43106c89b56f0f09e92c31659))
* **i18n:** derive every tooling locale/module list from the manifest (B132) ([#944](https://github.com/jaapstronks/deckyard/issues/944)) ([d70670c](https://github.com/jaapstronks/deckyard/commit/d70670c3964fdcd0c0bbb7fb651be08f905581ea))
* **i18n:** give the deck translation targets one source (B135) ([#945](https://github.com/jaapstronks/deckyard/issues/945)) ([4151c99](https://github.com/jaapstronks/deckyard/commit/4151c997b8997f71228611e39498da8e8af7cb29))
* **i18n:** one key, one module file — and en/ decides which (B137) ([#957](https://github.com/jaapstronks/deckyard/issues/957)) ([752eb06](https://github.com/jaapstronks/deckyard/commit/752eb06cfc58ad77f6c916c9a685d3506b851ebd))
* **i18n:** report the runtime-built keys a locale still needs (B136) ([#956](https://github.com/jaapstronks/deckyard/issues/956)) ([98d66f4](https://github.com/jaapstronks/deckyard/commit/98d66f4b08b2f8bbd0e68999378d0dba953912c0))
* **i18n:** walk item fields and nested itemFields when deriving live keys (B128) ([#940](https://github.com/jaapstronks/deckyard/issues/940)) ([d8f3d2d](https://github.com/jaapstronks/deckyard/commit/d8f3d2d320686cf1bc41f8ffede221de76792817))
* **slide-types:** validate deck saves against the organization's registry (B129) ([#942](https://github.com/jaapstronks/deckyard/issues/942)) ([26b9cc2](https://github.com/jaapstronks/deckyard/commit/26b9cc20b7c0f12cad47192a448f158899e50b45))

## [1.25.0](https://github.com/jaapstronks/deckyard/compare/v1.24.0...v1.25.0) (2026-08-23)


### Added

* **security:** put a CSP header on the app shell ([#921](https://github.com/jaapstronks/deckyard/issues/921)) ([baa259e](https://github.com/jaapstronks/deckyard/commit/baa259e5cc7d6e1f2f8001e2fb5a3f2c3f2aca44))
* **share:** give the guest verification failure a visible answer ([#927](https://github.com/jaapstronks/deckyard/issues/927)) ([d5cca70](https://github.com/jaapstronks/deckyard/commit/d5cca707d0445198fb437dcfacb3eaa5cab4241d))
* **slides:** derive the slide type scale from the slide's own box ([#931](https://github.com/jaapstronks/deckyard/issues/931)) ([5bb6cbb](https://github.com/jaapstronks/deckyard/commit/5bb6cbbdc718e3f8101395f1ca391535ab33a8fa))


### Fixed

* **auth:** give the dev bypass a valid address (dev@local.test) ([#924](https://github.com/jaapstronks/deckyard/issues/924)) ([f9e73cd](https://github.com/jaapstronks/deckyard/commit/f9e73cdd941acda962b3aaed6a05d020b09b4e65))
* **editor:** paste under a parent lands after its children, not inside ([#928](https://github.com/jaapstronks/deckyard/issues/928)) ([af535fe](https://github.com/jaapstronks/deckyard/commit/af535fe45ab3eaa418767368f9c76d24a91b4987))
* **share:** key guest-join error copy on the machine code and drop the duplicate email guard ([#923](https://github.com/jaapstronks/deckyard/issues/923)) ([378a484](https://github.com/jaapstronks/deckyard/commit/378a4843d399ad3a6c4055b8ab5b8479a399c634))
* **share:** serve the deck with verify so an anonymous link works ([#926](https://github.com/jaapstronks/deckyard/issues/926)) ([ad79d0c](https://github.com/jaapstronks/deckyard/commit/ad79d0cb2524fe30ae2eb6164c23fc47fd860772))
* **theme:** let anonymous viewers see the deck's own theme ([#929](https://github.com/jaapstronks/deckyard/issues/929)) ([24421bc](https://github.com/jaapstronks/deckyard/commit/24421bc4ed719c377433e34e1bc26f219c496677))

## [1.24.0](https://github.com/jaapstronks/deckyard/compare/v1.23.0...v1.24.0) (2026-08-22)


### ⚠ BREAKING CHANGES

* **api:** an API client that branched on any of the 21 removed error codes must read `error: "invalid"` plus `details.field` instead. The status is unchanged (400 throughout), and `details.field` names the input the code used to encode in its suffix.
* **authz:** a user who is a deck's `created_by` but not its owner, and who holds no collaborator row, can no longer write, delete, reshare or manage collaborators on that deck, and the editor now opens read-only for them. This is only reachable after an ownership transfer with `keepAsCollaborator: false`.

### Added

* **client:** remove the never-mounted cookie-consent banner ([#915](https://github.com/jaapstronks/deckyard/issues/915)) ([4da8bb3](https://github.com/jaapstronks/deckyard/commit/4da8bb359b912c931a3b784516b08fca947b8eda))
* **security:** send the document CSP as a header on /p/ and /embed/ ([#919](https://github.com/jaapstronks/deckyard/issues/919)) ([bf54022](https://github.com/jaapstronks/deckyard/commit/bf5402215830511f5c9699a641c669f195cf62c6))
* **security:** vendor hls.js and close the last render-path CDN ([#918](https://github.com/jaapstronks/deckyard/issues/918)) ([e368525](https://github.com/jaapstronks/deckyard/commit/e368525de364ce7edf35a92831b4c2bdddda153b))
* **server:** remove the lead-capture server infrastructure ([#914](https://github.com/jaapstronks/deckyard/issues/914)) ([3a880e7](https://github.com/jaapstronks/deckyard/commit/3a880e708e45c560c4c802283d21b696416cf713))
* **slides:** remove the lead-capture slide type and its viewer runtime ([#913](https://github.com/jaapstronks/deckyard/issues/913)) ([2a86fab](https://github.com/jaapstronks/deckyard/commit/2a86fab0fa7327ad34a23831e31dae9997727c81))


### Fixed

* **authz:** power over a deck reads the owner stamp, not owner-or-creator ([#916](https://github.com/jaapstronks/deckyard/issues/916)) ([088c861](https://github.com/jaapstronks/deckyard/commit/088c861a27f4170646b0447b5fb548d4cc368c6b))


### Changed

* **api:** collapse the 21 invalid_&lt;thing&gt; codes into invalid + field ([#917](https://github.com/jaapstronks/deckyard/issues/917)) ([33a16d4](https://github.com/jaapstronks/deckyard/commit/33a16d4b6c7d5ab8118ea630ed0ceb8c47d64d8a))
* cap the round-5 breaking changes at a beta minor ([4b0ae74](https://github.com/jaapstronks/deckyard/commit/4b0ae74d561549767889772b13e6495efa422cd1))

## [1.23.0](https://github.com/jaapstronks/deckyard/compare/v1.22.0...v1.23.0) (2026-08-22)


### ⚠ BREAKING CHANGES

* **api:** a storage reason answers the status its register entry states, not 400-by-default. `parent_not_found` is 404, `own_question` is 403, and the `'ours'` codes are 5xx. Eight codes were renamed to snake_case tokens; none of them had a client branch.
* **api:** a storage reason answers the status its register entry states, not 400-by-default. `parent_not_found` is 404, `own_question` is 403, and the `'ours'` codes are 5xx. Eight codes were renamed to snake_case tokens; none of them had a client branch.
* **api:** a storage reason answers the status its register entry states, not 400-by-default. `parent_not_found` is 404, `own_question` is 403, and the `'ours'` codes are 5xx. Eight codes were renamed to snake_case tokens; none of them had a client branch.
* **export:** the `<title>` of a print, PDF-slides or PNG-export document is now the deck title alone. Anything scraping those documents by title suffix will stop matching.
* **authz:** a creator who has transferred a deck away can no longer transfer it back. POST /api/presentations/:id/transfer-ownership answers 401 for an actor who holds only the creator stamp.
* **identity:** comments and slide locks name people with { id, displayName } (A1/D22) ([#850](https://github.com/jaapstronks/deckyard/issues/850))
* **identity:** name creators and trashers with { id, displayName } (A1/D22) ([#849](https://github.com/jaapstronks/deckyard/issues/849))
* **identity:** retire the e-mail fallback in identity matching (A1/D22) ([#848](https://github.com/jaapstronks/deckyard/issues/848))
* **identity:** `/api/v1/slide-library` returns `createdById` (the stable user id) instead of `createdBy` (the creator's email address), which was disclosed to any API key with library read access. The rest of the public v1 surface is unchanged — it already exposed ids only.
* **locks:** the `/api/presentations/:id/lock/*` routes, the `presentation_locks` / `lock_requests` tables and the `USE_DB_LOCKS` env var are removed.
* **media:** the media provider's env names changed. `MEDIA_STORAGE_MODE=scaleway` becomes `=s3`, and `SCW_ACCESS_KEY`/`SCW_SECRET_KEY`/`SCW_BUCKET`/`SCW_REGION`/`SCW_ENDPOINT`/`SCW_CDN_URL` become `S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT`/`S3_PUBLIC_URL`. The old names are still read until the first release after 2026-11-01 — only when their `S3_*` counterpart is unset, and every one that is read prints a boot warning naming its replacement (the B68 shape, no silent alias). For an untouched legacy install only, an unset endpoint is still derived as https://s3.<SCW_REGION>.scw.cloud; with the new names, `S3_ENDPOINT` is mandatory and `MEDIA_STORAGE_MODE=s3` refuses to boot without it.

### Added

* **api:** collapse the reason synonyms into one spelling each (D48) ([#910](https://github.com/jaapstronks/deckyard/issues/910)) ([9c2776a](https://github.com/jaapstronks/deckyard/commit/9c2776afa9643edcdab8d221f9c9c17a604c11b6))
* **api:** mint every storage reason from one REASONS register ([#908](https://github.com/jaapstronks/deckyard/issues/908)) ([07448f8](https://github.com/jaapstronks/deckyard/commit/07448f85a6165621f6e56605b470e84a4e38d750))
* **fork:** serve custom/styles/ and route fork fonts through the seam ([#873](https://github.com/jaapstronks/deckyard/issues/873)) ([46865a8](https://github.com/jaapstronks/deckyard/commit/46865a8e55c013a8ada22fb44bf939c75cd84e6c))
* **identity:** comments and slide locks name people with { id, displayName } (A1/D22) ([#850](https://github.com/jaapstronks/deckyard/issues/850)) ([f434b3d](https://github.com/jaapstronks/deckyard/commit/f434b3d7f72070d58b62250afaa2d15d9ced978d))
* **security:** emit a Content-Security-Policy from every render path ([#912](https://github.com/jaapstronks/deckyard/issues/912)) ([f34932b](https://github.com/jaapstronks/deckyard/commit/f34932b4578b4d5c3ebd059ac28809c25ebbf00f))
* **server:** one head chain for every render path, and one language resolver ([#890](https://github.com/jaapstronks/deckyard/issues/890)) ([caa1bfe](https://github.com/jaapstronks/deckyard/commit/caa1bfec69a9bd234936e05b81908baa977e93a7))
* **server:** one script chain, and code blocks that highlight everywhere ([#891](https://github.com/jaapstronks/deckyard/issues/891)) ([b685f01](https://github.com/jaapstronks/deckyard/commit/b685f01f70eaa2fb69db3694e0387bd29a8ea0c4))
* **server:** register every render path and give the reader the fork CSS seam ([#889](https://github.com/jaapstronks/deckyard/issues/889)) ([926f9b9](https://github.com/jaapstronks/deckyard/commit/926f9b945f36508c0b0d3ee4f14c552dcd83db12))
* **slide-types:** gate `sample` as a companion and fill the seven gaps (A5) ([09d8f4e](https://github.com/jaapstronks/deckyard/commit/09d8f4edb88b2dd8922062deceec822584a74237))


### Fixed

* **api:** answer every storage reason through the register, not per route ([#909](https://github.com/jaapstronks/deckyard/issues/909)) ([1f70903](https://github.com/jaapstronks/deckyard/commit/1f70903151b01305ddd3668caf111e6bff6ac732))
* **authz:** transfer ownership keys on the owner stamp, not the creator ([#901](https://github.com/jaapstronks/deckyard/issues/901)) ([de54c8d](https://github.com/jaapstronks/deckyard/commit/de54c8d8341ab241410c01338b0aa8559706f2c1))
* **client:** hand Escape back to the overlay and move the mobile modal rules to the base layer ([#888](https://github.com/jaapstronks/deckyard/issues/888)) ([735c13e](https://github.com/jaapstronks/deckyard/commit/735c13e3cea0d38c031f7bcca1883fbfbd9fc79d))
* **client:** move the generic .modal-content to the base layer and let Escape peel one overlay ([#884](https://github.com/jaapstronks/deckyard/issues/884)) ([e172027](https://github.com/jaapstronks/deckyard/commit/e172027b7d9fb65e4d6b6382a9ec0263e1b1f8f8))
* **css:** give form-input-sm/-xs a base definition ([#900](https://github.com/jaapstronks/deckyard/issues/900)) ([f1293fc](https://github.com/jaapstronks/deckyard/commit/f1293fcd74470364afd190d51a8c20f6b00d9e27))
* **docs:** repair the reference claims that were wrong, and gate the four shapes that rot ([#893](https://github.com/jaapstronks/deckyard/issues/893)) ([16aea2f](https://github.com/jaapstronks/deckyard/commit/16aea2f1365b3f8395b088ac3cc04db5329ff4f3))
* **editor:** "Add as second slide" puts the invite second ([#869](https://github.com/jaapstronks/deckyard/issues/869)) ([fde0af7](https://github.com/jaapstronks/deckyard/commit/fde0af7abcccaf7e0e6fffbb753f2d9166033ed3))
* **editor:** call the more-menu's on* handlers in one shape ([#905](https://github.com/jaapstronks/deckyard/issues/905)) ([c7cfa49](https://github.com/jaapstronks/deckyard/commit/c7cfa49f86bd58bcdd750b0c1b2e0d96b7152599))
* **editor:** copied slides keep their nesting and re-derive instance ids ([#855](https://github.com/jaapstronks/deckyard/issues/855)) ([5726fac](https://github.com/jaapstronks/deckyard/commit/5726fac3b50882f874000158a1086786ac7ffaf5))
* **editor:** wire each more-menu item once, closing before it acts ([#911](https://github.com/jaapstronks/deckyard/issues/911)) ([2864ff0](https://github.com/jaapstronks/deckyard/commit/2864ff0d002f18d07f7aeee2b4ecc944f69c4523))
* **export:** make the lead-capture consent divergence deliberate and localised ([#903](https://github.com/jaapstronks/deckyard/issues/903)) ([0b8ac1b](https://github.com/jaapstronks/deckyard/commit/0b8ac1b4de258bc57b870b7a1cf10a4dd2710c69))
* **export:** title a download with the deck name, and pin the reader's theme boundary ([#902](https://github.com/jaapstronks/deckyard/issues/902)) ([1946662](https://github.com/jaapstronks/deckyard/commit/1946662c93723032ef039d3dce3870e7e45af75c))
* **i18n:** one key, one English fallback, one ellipsis glyph ([#876](https://github.com/jaapstronks/deckyard/issues/876)) ([51046cc](https://github.com/jaapstronks/deckyard/commit/51046cc5a52e786b98b5d62184c57fc4ce1a9c57))
* **i18n:** stop the markdown import buttons from saying "Import JSON" ([#887](https://github.com/jaapstronks/deckyard/issues/887)) ([a6cdab4](https://github.com/jaapstronks/deckyard/commit/a6cdab4bac08f7c5772bc58ab955e59a0fc27148))
* **mcp:** install the stdout redirect before import-time logging (A5) ([21fd501](https://github.com/jaapstronks/deckyard/commit/21fd501c21e07f6636867263a2c71adfee26f59b))
* **security:** close the last two CodeQL alerts — one Notion error handler, data: reasoning in css-filter (B100) ([abf6413](https://github.com/jaapstronks/deckyard/commit/abf64131575db31cbce3fe06f081938a0b3fe854))
* **security:** serve Prism/KaTeX from the vendored copies in every render path ([#906](https://github.com/jaapstronks/deckyard/issues/906)) ([5486c67](https://github.com/jaapstronks/deckyard/commit/5486c67577153683ce9b27d647ecdc5f45db6fab))
* **security:** triage the open CodeQL alerts — host-match helper, crypto ids, workflow permissions (B100) ([f4879bc](https://github.com/jaapstronks/deckyard/commit/f4879bc15e7491846fbcde22bcaa3f42454ac4b0))
* **security:** validate analytics provider ids instead of escaping them ([#875](https://github.com/jaapstronks/deckyard/issues/875)) ([5dae9c9](https://github.com/jaapstronks/deckyard/commit/5dae9c9fadc33a1b38784a83a21207edbb0603b3))
* **security:** vendor pdf.js instead of loading it from cdnjs into headless Chrome ([#907](https://github.com/jaapstronks/deckyard/issues/907)) ([20cbb2c](https://github.com/jaapstronks/deckyard/commit/20cbb2c6496094df028a8377dce563840286363e))
* **server:** write every SSE frame through sseWrite() ([#885](https://github.com/jaapstronks/deckyard/issues/885)) ([68379e9](https://github.com/jaapstronks/deckyard/commit/68379e95d8920abce5c049a60bfdcb9b6c061c7f))


### Changed

* **identity:** name creators and trashers with { id, displayName } (A1/D22) ([#849](https://github.com/jaapstronks/deckyard/issues/849)) ([9917ec2](https://github.com/jaapstronks/deckyard/commit/9917ec296d3971f3589274dfd356fab5c0410444))
* **identity:** name people with { id, displayName }, not their address (A1/D22) ([#847](https://github.com/jaapstronks/deckyard/issues/847)) ([5197fe5](https://github.com/jaapstronks/deckyard/commit/5197fe563a3f53a332e841b68f3437dfbff7df4c))
* **identity:** retire the e-mail fallback in identity matching (A1/D22) ([#848](https://github.com/jaapstronks/deckyard/issues/848)) ([2521e51](https://github.com/jaapstronks/deckyard/commit/2521e519c3c9c8b01fd85020e9e4fc0b2f913008))
* **locks:** strip the presentation-level lock surface, drop its tables (B96, D40) ([1c17283](https://github.com/jaapstronks/deckyard/commit/1c17283e95711f9e2d08dcdd7ad32e4d8eb0c135))
* **media:** rename the scaleway media provider to s3 and its env to S3_* (B98) ([a1224f9](https://github.com/jaapstronks/deckyard/commit/a1224f96ff87b7230d92246bdc3f68c326b5edae))

## [1.22.0](https://github.com/jaapstronks/deckyard/compare/v1.21.0...v1.22.0) (2026-08-19)


### ⚠ BREAKING CHANGES

* **themes:** the built-in theme id `deckyard` is now `amethyst` (label "Amethyst", neutral placeholder logo instead of the green mark); no alias is kept. A deck stored with "theme": "deckyard" still loads and renders in the default theme (brand / Forest), but fails validation on its next save until it is re-themed. Custom themes in custom/themes/ are unaffected. Version stays 1.x per versioning.md § The beta stance.

### Fixed

* **i18n:** fill the descriptor-table key gaps and teach the coverage gate to see them ([#831](https://github.com/jaapstronks/deckyard/issues/831)) ([ed3c907](https://github.com/jaapstronks/deckyard/commit/ed3c907dc6cddf4247c40051272f205a9238e802))
* **sanitize:** initialize the sanitizer in the MCP process, warn when it is missing ([#836](https://github.com/jaapstronks/deckyard/issues/836)) ([aa71704](https://github.com/jaapstronks/deckyard/commit/aa71704fd8ad2534aef9f0e69ddb27b5eefdec7d))


### Changed

* **themes:** rename the deckyard theme to amethyst and give it the neutral logo ([#837](https://github.com/jaapstronks/deckyard/issues/837)) ([fb3e5d3](https://github.com/jaapstronks/deckyard/commit/fb3e5d3f7a127bb330784f6fc3a8c2819151b379))

## [1.21.0](https://github.com/jaapstronks/deckyard/compare/v1.20.0...v1.21.0) (2026-08-19)


### Added

* converge internal + v1 publish on one shared core (B62 vondst 8) ([#785](https://github.com/jaapstronks/deckyard/issues/785)) ([3359abd](https://github.com/jaapstronks/deckyard/commit/3359abd7cde114959b18a43e6ca90a6ae2c60a0b))
* converge public API v1 on one error envelope (B61) ([#783](https://github.com/jaapstronks/deckyard/issues/783)) ([5310328](https://github.com/jaapstronks/deckyard/commit/53103289d134bf8a6112fe176274ed665d702647))
* expose leads.retentionDays in the admin settings UI (B82) ([#795](https://github.com/jaapstronks/deckyard/issues/795)) ([b607ead](https://github.com/jaapstronks/deckyard/commit/b607eade3f3033207065dbb903692b0a1d75b6f7))
* expose the lead.submitted webhook in the admin UI (B72) ([#787](https://github.com/jaapstronks/deckyard/issues/787)) ([65d2b3d](https://github.com/jaapstronks/deckyard/commit/65d2b3df9e9250dacc71a53a7a150d33b7887bfc))
* make the leads my-data self-service routes public (B63b) ([#780](https://github.com/jaapstronks/deckyard/issues/780)) ([1b98fe6](https://github.com/jaapstronks/deckyard/commit/1b98fe658dd4ac52dcf23f00ee43e90f782b668f))
* my-data landing page + durable GDPR token store (B63b-rest) ([#782](https://github.com/jaapstronks/deckyard/issues/782)) ([e013dce](https://github.com/jaapstronks/deckyard/commit/e013dcee3c2799cc8d3efe7661b189f7ae85b8e3))
* re-host Notion images via the media library without ImageKit (B80) ([#797](https://github.com/jaapstronks/deckyard/issues/797)) ([add2a8c](https://github.com/jaapstronks/deckyard/commit/add2a8c51d247e31a496b32816728dff78ac6dfb))
* webhook actor.id -&gt; users.id, opt-in HMAC signing, rebrand user-agent (B81) ([#799](https://github.com/jaapstronks/deckyard/issues/799)) ([7ce09a9](https://github.com/jaapstronks/deckyard/commit/7ce09a986a0736a7d1504cc1460ee9bc313f9253))


### Fixed

* cap normal two-column lists at 6 when a subheading meets 3-line titles (B54) ([#794](https://github.com/jaapstronks/deckyard/issues/794)) ([eb66a08](https://github.com/jaapstronks/deckyard/commit/eb66a0884fa38b8848728e6e0931029bc24dd538))
* resolve team-library authz guard and list facades past the latent 100-row cap (B85) ([c387de9](https://github.com/jaapstronks/deckyard/commit/c387de93de6213465d7ff3ca9c0152219524605d))


### Security

* SSRF-guard the Notion image re-host fetches, enforce Scaleway maxBytes (B84) ([#807](https://github.com/jaapstronks/deckyard/issues/807)) ([2a86be1](https://github.com/jaapstronks/deckyard/commit/2a86be1b52dab9868f9e03e2a3537c4f3c9a1988))

## [1.20.0](https://github.com/jaapstronks/deckyard/compare/v1.19.0...v1.20.0) (2026-08-17)


### Added

* deliver GDPR my-data verification token by email (B63) ([#779](https://github.com/jaapstronks/deckyard/issues/779)) ([8b100c9](https://github.com/jaapstronks/deckyard/commit/8b100c9e401724069aa2139211f4d8b8d1088b62))
* remove the unimplemented on-view refresh mode ([#776](https://github.com/jaapstronks/deckyard/issues/776)) ([68eab89](https://github.com/jaapstronks/deckyard/commit/68eab89c1727eca30ff781d70bcf078cc8bc1d90))
* rename DISABLE_* kill switches to *_ENABLED enable polarity ([#778](https://github.com/jaapstronks/deckyard/issues/778)) ([6ec2856](https://github.com/jaapstronks/deckyard/commit/6ec28564102690c32a801fcfea8f8da0fa4c29df))


### Fixed

* route MCP tool writes through the maintenance gate ([#771](https://github.com/jaapstronks/deckyard/issues/771)) ([0a38026](https://github.com/jaapstronks/deckyard/commit/0a380261ea551f809bdfcf1fcf9c7a2764ec560b))


### Security

* drop the unauthorized datasource:refreshed SSE broadcast ([#777](https://github.com/jaapstronks/deckyard/issues/777)) ([72f4fa9](https://github.com/jaapstronks/deckyard/commit/72f4fa99279040193c3efb3f3529b33761418e69))
* scope analytics report mutations to their own presentation ([#766](https://github.com/jaapstronks/deckyard/issues/766)) ([d4c3103](https://github.com/jaapstronks/deckyard/commit/d4c3103fb2e8c9169fd80f7c57a988ac83bfbe88))

## [1.19.0](https://github.com/jaapstronks/deckyard/compare/v1.18.0...v1.19.0) (2026-08-16)


### ⚠ BREAKING CHANGES

* Themes no longer have per-slide-type tokens; every theme lever is a role token. Per family: --t-kpi-tile-{1..4}-*/--t-kpi-delta-* — removed, tiles render the neutral defaults; a coloured series comes from --t-chart-*. --t-table-<variant>-* — removed, table planes follow --t-color-accent(+contrast) and the mist/raised surfaces. --t-icon-card-grid-* — removed; the icon plane derives from mist/accent (override: --t-color-accent-soft), card bodies read --t-color-surface-raised, header text follows the gradient/on-surface roles. --t-quote-text-color/--t-chapter-text-color — replaced by --t-slide-bg-dark-text; --t-quote-author-color — renamed --t-color-accent-on-dark. --t-list-item-title-letter-spacing — removed. The legacy aliases --t-primary/--t-accent/--t-bg-dark/--t-brand-1/2 are no longer emitted; brand slots --t-color-brand-{1..3} fill from brandColors. Unknown tokens in existing themes are harmless (they do nothing); decks render with role-derived styling.
* retire the legacy theme aliases and close the --t-* contract (A7.9 phase 3 steps 4-6) ([#750](https://github.com/jaapstronks/deckyard/issues/750))

### Fixed

* DELETE /api/leads/my-data reaches the erasure handler instead of the :id row ([#710](https://github.com/jaapstronks/deckyard/issues/710)) ([c2f90aa](https://github.com/jaapstronks/deckyard/commit/c2f90aa7f65511e58847869fa9b76c02004c6c10))
* fresh invitations no longer show 'expired' in the admin user list ([#706](https://github.com/jaapstronks/deckyard/issues/706)) ([6fc6108](https://github.com/jaapstronks/deckyard/commit/6fc6108c3d251daaa1c7f268941b2cd6cd70eeea))
* queued exports read the export type from the job name ([#712](https://github.com/jaapstronks/deckyard/issues/712)) ([bd88ed5](https://github.com/jaapstronks/deckyard/commit/bd88ed5f60f63bcc58112b99133bd1ab5756ae92))
* route error stragglers onto the canonical envelope (C7a) ([#723](https://github.com/jaapstronks/deckyard/issues/723)) ([1d463cb](https://github.com/jaapstronks/deckyard/commit/1d463cb963ed048e1dadbd60261887ea271c32a4))
* stub out the unused, unpatched image-size transitive dependency (B59) ([#747](https://github.com/jaapstronks/deckyard/issues/747)) ([df884c5](https://github.com/jaapstronks/deckyard/commit/df884c51e8425aeb2698d968e8e4040244ce33ae))
* type sendEmail failures — misconfig answers 501, upstream stays 502 (B60) ([#751](https://github.com/jaapstronks/deckyard/issues/751)) ([b2b994d](https://github.com/jaapstronks/deckyard/commit/b2b994d5387b24d63f35b8efbf38c597f2eb6833))


### Changed

* release note for the phase-3 theme-token consolidation ([#746](https://github.com/jaapstronks/deckyard/issues/746), [#748](https://github.com/jaapstronks/deckyard/issues/748)-[#750](https://github.com/jaapstronks/deckyard/issues/750)) ([cf5081c](https://github.com/jaapstronks/deckyard/commit/cf5081c09653f250476ac5bae8dc58f12b051fa4))
* retire the legacy theme aliases and close the --t-* contract (A7.9 phase 3 steps 4-6) ([#750](https://github.com/jaapstronks/deckyard/issues/750)) ([ba13785](https://github.com/jaapstronks/deckyard/commit/ba13785f2e97749b2d41134e43a77c91c795e8d0))

## [1.18.0](https://github.com/jaapstronks/deckyard/compare/v1.17.0...v1.18.0) (2026-08-10)


### ⚠ BREAKING CHANGES

* **server:** slide-library tag PUTs take { tags: [...] } only (B55) ([#684](https://github.com/jaapstronks/deckyard/issues/684))

### Added

* **collaborators:** make the access log symmetric — log revoke + permission change, deliver revocation message ([#664](https://github.com/jaapstronks/deckyard/issues/664)) ([7d65e0d](https://github.com/jaapstronks/deckyard/commit/7d65e0d8d51e8b3668fe303bda42c58f23628a7b))
* dual-key presentation_versions.created_by on users.id ([#647](https://github.com/jaapstronks/deckyard/issues/647)) ([9ec1ddf](https://github.com/jaapstronks/deckyard/commit/9ec1ddf79587e2b49935d6426644054b8e5f470d))
* key slide/presentation locks and live SSE on users.id (T10 F3) ([#650](https://github.com/jaapstronks/deckyard/issues/650)) ([32dce87](https://github.com/jaapstronks/deckyard/commit/32dce873cb9a5d71d945455d6d7076d177a463ba))
* route trash and slide-library authz through identity-match ([#648](https://github.com/jaapstronks/deckyard/issues/648)) ([7c24965](https://github.com/jaapstronks/deckyard/commit/7c24965918f36b9b3c21a9a517e78136966f9683))
* **server:** make requireJsonBody the single JSON body entry point ([#657](https://github.com/jaapstronks/deckyard/issues/657)) ([8d6505d](https://github.com/jaapstronks/deckyard/commit/8d6505df93c951591c51642a8d04caa11a04caed))
* **server:** slide-library tag PUTs take { tags: [...] } only (B55) ([#684](https://github.com/jaapstronks/deckyard/issues/684)) ([5c134c9](https://github.com/jaapstronks/deckyard/commit/5c134c99b45d567029c4e2ae5c63f73564e953d9))
* **vocab:** scope becomes visibility, the tenant entity is organization everywhere ([#668](https://github.com/jaapstronks/deckyard/issues/668)) ([d03f2fb](https://github.com/jaapstronks/deckyard/commit/d03f2fbbfdb338171daced8ab2da5b5f638e57cc))


### Fixed

* **analytics:** derive device labels with an ephemeral key in secretless boot modes ([#662](https://github.com/jaapstronks/deckyard/issues/662)) ([27e5921](https://github.com/jaapstronks/deckyard/commit/27e5921b2f72bed8acd751e0b8bd84ab60bed8d2))
* **analytics:** honour settings retention, drop dead analytics tables ([#660](https://github.com/jaapstronks/deckyard/issues/660)) ([4ad5b70](https://github.com/jaapstronks/deckyard/commit/4ad5b7007b02c12f51b17ca60148e3b8376035bb))
* **comparison:** subheading sits one scale step above the column prose ([#669](https://github.com/jaapstronks/deckyard/issues/669)) ([76b62ff](https://github.com/jaapstronks/deckyard/commit/76b62ff0eb4b688153d92a6824b828dc8053ac34))
* **email:** one canonical template-type list; drop dead exportReady path ([#659](https://github.com/jaapstronks/deckyard/issues/659)) ([7859ca8](https://github.com/jaapstronks/deckyard/commit/7859ca85bbc987b11583f630863ad8c8e9ee697a))
* **lint:** restore dead-exports detection with a Node scanner (B47) ([#661](https://github.com/jaapstronks/deckyard/issues/661)) ([3c80b81](https://github.com/jaapstronks/deckyard/commit/3c80b81a2bbea46551915dffafd9e701e1063330))
* **list-slide:** re-measure itemCapacity on the current sizes ([#670](https://github.com/jaapstronks/deckyard/issues/670)) ([6aebc9c](https://github.com/jaapstronks/deckyard/commit/6aebc9cad0577d69a8880adaee0a783b4002d936))
* **schema:** fold away every remaining inert per-field align key (v5-&gt;v6) ([#663](https://github.com/jaapstronks/deckyard/issues/663)) ([212c82a](https://github.com/jaapstronks/deckyard/commit/212c82ac7e93a513ecf82287f33eac63afdbe614))
* **server:** the JSON body entry rejects non-object bodies itself ([#673](https://github.com/jaapstronks/deckyard/issues/673)) ([9f878c4](https://github.com/jaapstronks/deckyard/commit/9f878c45f7ea8afda3973ce28d85f9dbd19c1ba7))
* **tests:** silence migrate-import stdout to stop node --test IPC deserialize flake ([#666](https://github.com/jaapstronks/deckyard/issues/666)) ([1e73a6d](https://github.com/jaapstronks/deckyard/commit/1e73a6d177c80dcc4e4636a978550303371c2323))


### Changed

* cap the B55 breaking change at a beta minor ([5c8b43d](https://github.com/jaapstronks/deckyard/commit/5c8b43d57ca22b18bb0c6128becb696162cdbdba))

## [1.17.0](https://github.com/jaapstronks/deckyard/compare/v1.16.0...v1.17.0) (2026-08-05)


### Added

* **analytics:** anonymous viewers can erase their own data (session-token proof-of-possession) ([#637](https://github.com/jaapstronks/deckyard/issues/637)) ([52b7f41](https://github.com/jaapstronks/deckyard/commit/52b7f41f1eb42ac31c3a35d42e5e6806e34100b4))
* **analytics:** drop the internal/external tracking toggle, leaving analytics.enabled as the only switch ([#635](https://github.com/jaapstronks/deckyard/issues/635)) ([0172041](https://github.com/jaapstronks/deckyard/commit/0172041a56cbad47fad0f0df4470fd477c82252b))
* **api:** carry ownerId as the identity in responses and compare it on the client ([#640](https://github.com/jaapstronks/deckyard/issues/640)) ([5d653d2](https://github.com/jaapstronks/deckyard/commit/5d653d2e3572ea939c2e6fa31ec2e00b049eb148))
* **authz:** decide presentation ownership on users.id instead of the email string ([#638](https://github.com/jaapstronks/deckyard/issues/638)) ([1b5c229](https://github.com/jaapstronks/deckyard/commit/1b5c229c0f87e93865b3320093bda0fafa47e362))
* **authz:** decide the workspace grant against the actor's own organization (L10) ([#639](https://github.com/jaapstronks/deckyard/issues/639)) ([566d970](https://github.com/jaapstronks/deckyard/commit/566d970591f4722bb9c7e536515841476d2b5cf4))
* **identity:** key user_settings on users.id (T10 PR E) ([#643](https://github.com/jaapstronks/deckyard/issues/643)) ([a0c2af9](https://github.com/jaapstronks/deckyard/commit/a0c2af9c883d24808fdcaf305c47ba8cd5ed3047))
* **identity:** verify and backfill the identity data migration (T10 PR G) ([#646](https://github.com/jaapstronks/deckyard/issues/646)) ([6ea1181](https://github.com/jaapstronks/deckyard/commit/6ea11815ccec78b0d24b4c56dae36eaac2573dd6))
* **notes:** let the join link edit the session's speaker notes ([#632](https://github.com/jaapstronks/deckyard/issues/632)) ([e6823c9](https://github.com/jaapstronks/deckyard/commit/e6823c986cb7d6c0a4280bc10b21abc41a67450a))


### Fixed

* **analytics:** make the identifier the scope on the last two org-blind seams ([#629](https://github.com/jaapstronks/deckyard/issues/629)) ([688c843](https://github.com/jaapstronks/deckyard/commit/688c8439a79e0352d3424f4a2b7e4dcc7ef83201))
* **collaborators:** a failed invite insert answers 500, not 400 ([#642](https://github.com/jaapstronks/deckyard/issues/642)) ([d389a32](https://github.com/jaapstronks/deckyard/commit/d389a322c2d82a285989633eaaf2f1b24e36a9ea))
* **db:** honor DATABASE_URL over DATABASE_* in db:migrate ([#631](https://github.com/jaapstronks/deckyard/issues/631)) ([19a4f28](https://github.com/jaapstronks/deckyard/commit/19a4f28b0f379dd52c370231e7c658fbda007fd2))
* **export:** queued exports load their theme through loadTheme ([#641](https://github.com/jaapstronks/deckyard/issues/641)) ([7f56e38](https://github.com/jaapstronks/deckyard/commit/7f56e38a90c132b1fd9528cc5752730a39a95f77))
* **share:** branch the invite failure on e.code, not on the message ([#645](https://github.com/jaapstronks/deckyard/issues/645)) ([39e548a](https://github.com/jaapstronks/deckyard/commit/39e548a9ec76426b950fb6b0b949eb44c74ce9d2))


### Security

* **analytics:** drop sessionToken from the sessions list response ([#636](https://github.com/jaapstronks/deckyard/issues/636)) ([51cb500](https://github.com/jaapstronks/deckyard/commit/51cb500d9484fed838f12a1858c17bf21ab66d7b))
* **analytics:** return a per-deck device label instead of the raw device id ([#634](https://github.com/jaapstronks/deckyard/issues/634)) ([23748b4](https://github.com/jaapstronks/deckyard/commit/23748b44d2df390477d895f3ebfbdd34d191cbf1))

## [1.16.0](https://github.com/jaapstronks/deckyard/compare/v1.15.0...v1.16.0) (2026-08-04)


### Added

* **authz:** add owner/created_by/updated_by user_id to presentations (T10 PR 3) ([#616](https://github.com/jaapstronks/deckyard/issues/616)) ([aa0c591](https://github.com/jaapstronks/deckyard/commit/aa0c5911349322613ea19ef3a89ad0e29dd77c40))
* **authz:** add user_id to collaborators alongside user_email (T10 PR 2) ([#613](https://github.com/jaapstronks/deckyard/issues/613)) ([3a239c2](https://github.com/jaapstronks/deckyard/commit/3a239c21443eaba35c11780f6da78c18a6d47550))
* **authz:** persist owner on PG ownership transfer (T10 tail) ([a0fed94](https://github.com/jaapstronks/deckyard/commit/a0fed945deaaa6c30869f35602eb3b9b9bd842a8))
* **storage:** move questions, interactions and feedback from disk JSON to Postgres ([#606](https://github.com/jaapstronks/deckyard/issues/606)) ([0a5b932](https://github.com/jaapstronks/deckyard/commit/0a5b932c57efdd36b2b3270baf0c889c44e928dc))


### Fixed

* **authz:** scope collaborator rows on the deck, not the session ([#626](https://github.com/jaapstronks/deckyard/issues/626)) ([fdacfb2](https://github.com/jaapstronks/deckyard/commit/fdacfb22db66f31dd35dca7160e1fc5c26124025))
* **editor:** make a failing language switch visible ([#620](https://github.com/jaapstronks/deckyard/issues/620)) ([596ee2f](https://github.com/jaapstronks/deckyard/commit/596ee2f661e7f7e5f19d9f954ebf92ba6f9d56bb))


### Security

* **share-links:** rate-limit the public password verify ([#628](https://github.com/jaapstronks/deckyard/issues/628)) ([9cd3898](https://github.com/jaapstronks/deckyard/commit/9cd3898dd217c01fcc064038aada5ffa4b14e54e))

## [1.15.0](https://github.com/jaapstronks/deckyard/compare/v1.14.0...v1.15.0) (2026-08-03)


### ⚠ BREAKING CHANGES

* **slide-types:** seven slide-type CSS classes are no longer emitted (team-cards-group-left, kpi-note, quote-author-text, poll-results-main, sfi-header, sfi-card-code, sfi-card-qr). No core stylesheet targeted them, so Deckyard's own themes are unaffected; a fork that styled any of these names against its own copy of the slide types must move those rules to the surviving class on the same element.

### Added

* **i18n:** tier UI locales - nl/en gated, ten best-effort ([12c9bad](https://github.com/jaapstronks/deckyard/commit/12c9bad4111b737f926d15a908f00a58a492a539))
* **import:** complete the file→Postgres import path ([#586](https://github.com/jaapstronks/deckyard/issues/586)) ([53fe563](https://github.com/jaapstronks/deckyard/commit/53fe56300ddf882e151b4ac82e6c6527c71243be))
* **ops:** ship Postgres in the compose stack ([#585](https://github.com/jaapstronks/deckyard/issues/585)) ([4c93690](https://github.com/jaapstronks/deckyard/commit/4c93690f607ad2b5cec850997a8067709e55fef6))
* **sandbox:** run sandbox TTL cleanup and quota on Postgres ([#589](https://github.com/jaapstronks/deckyard/issues/589)) ([3cd1d3d](https://github.com/jaapstronks/deckyard/commit/3cd1d3d83756665c4bae2fb877c242abb9fd3355))
* **storage:** default STORAGE_MODE to postgres with a boot guard for file data ([#587](https://github.com/jaapstronks/deckyard/issues/587)) ([12b9a3b](https://github.com/jaapstronks/deckyard/commit/12b9a3bb6c3a38d90073f4c199deac23122139d8))
* **storage:** move email templates from disk JSON to Postgres ([#602](https://github.com/jaapstronks/deckyard/issues/602)) ([e6d2d35](https://github.com/jaapstronks/deckyard/commit/e6d2d35fd97b3fe0b0f1c8fd206bdf622dbd7236))
* **storage:** move live sessions and follow codes from disk JSON to Postgres ([#604](https://github.com/jaapstronks/deckyard/issues/604)) ([96aa349](https://github.com/jaapstronks/deckyard/commit/96aa349f604bf7d484f84700de91a6407daafe42))
* **storage:** move settings from disk JSON to Postgres ([#603](https://github.com/jaapstronks/deckyard/issues/603)) ([e0c4072](https://github.com/jaapstronks/deckyard/commit/e0c4072c8d7daab1e5adf24643437613e0c17393))
* **storage:** remove the file storage backend ([#595](https://github.com/jaapstronks/deckyard/issues/595)) ([1825a2f](https://github.com/jaapstronks/deckyard/commit/1825a2f1dc9bb6c7f358a2969a7d4e9e966e1e7d))


### Fixed

* **image-library:** find image usage in the presentations table, not on disk ([#601](https://github.com/jaapstronks/deckyard/issues/601)) ([6a84975](https://github.com/jaapstronks/deckyard/commit/6a84975899210313355e9d6c0ef3dbd6c2366f38))
* **install:** pass the local compose overlay and fail fast on a stale DATABASE_HOST ([#598](https://github.com/jaapstronks/deckyard/issues/598)) ([4ae2f0d](https://github.com/jaapstronks/deckyard/commit/4ae2f0d5275f23f99a348474921977c0c9190770))


### Changed

* **auth:** reuse the active membership for designer resolution ([06d8122](https://github.com/jaapstronks/deckyard/commit/06d812291a76fd964e3569058bca69bbf3c1d9cc))
* **main:** revert the 2.0.0 release bookkeeping, keep numbering in 1.x ([51103e7](https://github.com/jaapstronks/deckyard/commit/51103e7bdb9b760c554cba96ad64b6535b97124c))
* **slide-types:** drop seven dead emitted CSS classes ([#599](https://github.com/jaapstronks/deckyard/issues/599)) ([6347085](https://github.com/jaapstronks/deckyard/commit/6347085397e5bc2497cc8fce6efe1a8638c22b78))

## [1.14.0](https://github.com/jaapstronks/deckyard/compare/v1.13.0...v1.14.0) (2026-08-03)


### Added

* **slides:** add role tokens and the slide-roles reference (role-vocabulary phase 1) ([#571](https://github.com/jaapstronks/deckyard/issues/571)) ([3309330](https://github.com/jaapstronks/deckyard/commit/3309330856340e82b72e601fa3a046c9b9825f2a))


### Fixed

* **test:** key slide-css gate scales per category + drop dead .slide-header rules ([#576](https://github.com/jaapstronks/deckyard/issues/576)) ([037d432](https://github.com/jaapstronks/deckyard/commit/037d432302828010597e8734736c8cb3bde5ebaf))


### Security

* self-host Prism and KaTeX, loaded lazily by the app shell (B33) ([#565](https://github.com/jaapstronks/deckyard/issues/565)) ([c54bf9f](https://github.com/jaapstronks/deckyard/commit/c54bf9f3a1a9aa47830f56a805c14263be8af7c2))

## [1.13.0](https://github.com/jaapstronks/deckyard/compare/v1.12.1...v1.13.0) (2026-08-03)


### Added

* bundled gradients as a licence-free image source ([#560](https://github.com/jaapstronks/deckyard/issues/560)) ([bc4a88f](https://github.com/jaapstronks/deckyard/commit/bc4a88f051a24a34ffc1ebc9496bca06a0dbb812))
* **capture:** hash the recipe module graph instead of the entry file ([#545](https://github.com/jaapstronks/deckyard/issues/545)) ([abe8d69](https://github.com/jaapstronks/deckyard/commit/abe8d69364d00b0ad46b30575316cacc425ca9c1))
* **ci:** resolve every relative import, and make the doc gate fork-configurable ([#550](https://github.com/jaapstronks/deckyard/issues/550)) ([05f3cc1](https://github.com/jaapstronks/deckyard/commit/05f3cc11c3d837f24979408af819259c3a318c59))
* **css:** refine the spacing scale to 2px and gate its use ([#553](https://github.com/jaapstronks/deckyard/issues/553)) ([ad0c404](https://github.com/jaapstronks/deckyard/commit/ad0c4045dcb5ec2e172e6efbc980525cea337337))
* **test:** the classes a slide type emits must resolve to a CSS rule ([#554](https://github.com/jaapstronks/deckyard/issues/554)) ([397955b](https://github.com/jaapstronks/deckyard/commit/397955b5ee6065072fbeee882cd9d133ebddaa57))


### Fixed

* **fonts:** pin self-hosted Google Fonts and ship the Latin subsets ([#546](https://github.com/jaapstronks/deckyard/issues/546)) ([6fb558e](https://github.com/jaapstronks/deckyard/commit/6fb558e02af5ea3cb34cf1e14c446e164bbec658))
* **slide-types:** re-export SCHEMA_BASE_URI for the website generator ([#564](https://github.com/jaapstronks/deckyard/issues/564)) ([71de779](https://github.com/jaapstronks/deckyard/commit/71de779013f5319ace5c9b4caf956fd7e60ef949))
* **slide-types:** re-export SLIDE_STRUCTURES for the website generator ([#558](https://github.com/jaapstronks/deckyard/issues/558)) ([97d5e7b](https://github.com/jaapstronks/deckyard/commit/97d5e7bbf95841e4a8bf41443cb95822ef7606d3))
* **slide-types:** re-export the runtime and interaction vocabularies ([#559](https://github.com/jaapstronks/deckyard/issues/559)) ([f0df831](https://github.com/jaapstronks/deckyard/commit/f0df8316b5b2298863629c11646fbb3c39121cc6))


### Security

* self-host DOMPurify instead of loading it from a CDN ([#563](https://github.com/jaapstronks/deckyard/issues/563)) ([f200ec7](https://github.com/jaapstronks/deckyard/commit/f200ec7306f517a80644337443dbac156577c15d))

## [1.12.1](https://github.com/jaapstronks/deckyard/compare/v1.12.0...v1.12.1) (2026-08-02)


### Fixed

* derive readable link colour for theme slide-background variants ([#540](https://github.com/jaapstronks/deckyard/issues/540)) ([52d61c9](https://github.com/jaapstronks/deckyard/commit/52d61c90be5c7d4c0900b1786ef679d54f12fe9f))


### Changed

* lazy-load Bunny Player.js in the live app ([#542](https://github.com/jaapstronks/deckyard/issues/542)) ([6385c82](https://github.com/jaapstronks/deckyard/commit/6385c8225df4b61d5ca048324f43e4cead5d9ac4))

## [1.12.0](https://github.com/jaapstronks/deckyard/compare/v1.11.0...v1.12.0) (2026-08-02)


### Added

* **editor:** closed per-field editor vocabulary replaces the chart and table forms ([#526](https://github.com/jaapstronks/deckyard/issues/526)) ([d728ae4](https://github.com/jaapstronks/deckyard/commit/d728ae49f4ef57dd8508a8ead3d8874b3a175d32))
* **editor:** one generic collection editor replaces the seven hand-built forms ([#524](https://github.com/jaapstronks/deckyard/issues/524)) ([7e465ef](https://github.com/jaapstronks/deckyard/commit/7e465ef11a7c9775460fbd9518fb5d5f105193d5))
* **editor:** resolve itemDefaults per deck language via itemDefaultsByLang ([#527](https://github.com/jaapstronks/deckyard/issues/527)) ([1289c6b](https://github.com/jaapstronks/deckyard/commit/1289c6bb45820dd7334e2f62f8a609625875dd72))
* **editor:** the image forms become declarations and the shared element card ([#528](https://github.com/jaapstronks/deckyard/issues/528)) ([abfd48d](https://github.com/jaapstronks/deckyard/commit/abfd48d649260fbd4c16f655e7a6de2df82c587c))
* **editor:** the slide-list label reads the labelField declaration ([#530](https://github.com/jaapstronks/deckyard/issues/530)) ([ac406c0](https://github.com/jaapstronks/deckyard/commit/ac406c0e0b5d21e4989177c262bfba8181cfb49c))
* **jobs:** schedule the three unwired retention cleanups ([#537](https://github.com/jaapstronks/deckyard/issues/537)) ([ff2d96f](https://github.com/jaapstronks/deckyard/commit/ff2d96f2c1e04b53f38e41390dcc42967738c717))
* **slide-types:** per-type CSS claimed in the TYPE_CSS manifest (seam-collapse gate point 6, PR 1) ([#534](https://github.com/jaapstronks/deckyard/issues/534)) ([06e3253](https://github.com/jaapstronks/deckyard/commit/06e32534e02e267915d32b225a794e88e64587f3))


### Fixed

* **i18n:** ?lang= is the only UI-locale URL param, the ?locale= alias is removed ([#529](https://github.com/jaapstronks/deckyard/issues/529)) ([12c4646](https://github.com/jaapstronks/deckyard/commit/12c46467ed4d25581af52c72535baa77e9769944))
* **i18n:** let ?lang= URL param outrank the saved uiLocale for the session ([#520](https://github.com/jaapstronks/deckyard/issues/520)) ([95ee83f](https://github.com/jaapstronks/deckyard/commit/95ee83fc54592aa6e6488a7aa212b9e7cb2b2992))
* **quote-slide:** the editor canvas stops reflowing on focus, and a delegated control stops looking broken ([#525](https://github.com/jaapstronks/deckyard/issues/525)) ([c9337e0](https://github.com/jaapstronks/deckyard/commit/c9337e00de84be629d41c4043afdb818a024cb6b))

## [1.11.0](https://github.com/jaapstronks/deckyard/compare/v1.10.0...v1.11.0) (2026-08-01)


### Added

* **api:** canonicalize slides[].type on export/read; drop slideTypes manifest ([#514](https://github.com/jaapstronks/deckyard/issues/514)) ([2dffe2b](https://github.com/jaapstronks/deckyard/commit/2dffe2b157f1825f9d331ba08c169a73a9d2ed41))
* **api:** one write-seam validates and normalizes slides[].type ([#511](https://github.com/jaapstronks/deckyard/issues/511)) ([0e2973d](https://github.com/jaapstronks/deckyard/commit/0e2973d5e7db51bd324433ea799c947278f71034))
* **capture:** tranche-2 marketing recipes for the /features page ([#512](https://github.com/jaapstronks/deckyard/issues/512)) ([e723f42](https://github.com/jaapstronks/deckyard/commit/e723f42709466a08af32608f6e49197c2340f037))
* **organizations:** invite people, and let members reach the member list ([94442eb](https://github.com/jaapstronks/deckyard/commit/94442ebb5b2ac9dc5bf8b5584fd68bd111098684))
* **organizations:** organization profile screen, with delete for the owner ([#498](https://github.com/jaapstronks/deckyard/issues/498)) ([2773f6c](https://github.com/jaapstronks/deckyard/commit/2773f6cecfb18e161297bdca694abb712854b26d))
* **slide-types:** three tiers and a `fallback` facet that enforces them ([#502](https://github.com/jaapstronks/deckyard/issues/502)) ([eba33ec](https://github.com/jaapstronks/deckyard/commit/eba33ec0b8743f2971d55815148e07d220b9d14c))
* **slide-types:** v3-&gt;v4 migration folds stored type spellings to the registry key ([#515](https://github.com/jaapstronks/deckyard/issues/515)) ([8db6bff](https://github.com/jaapstronks/deckyard/commit/8db6bffbee5472afa47da8115acca7b524cb0f8c))
* **spec:** open the published schema and make `structure` normative ([#504](https://github.com/jaapstronks/deckyard/issues/504)) ([fea73f0](https://github.com/jaapstronks/deckyard/commit/fea73f00106cfffd24acbcfd61c651cf31870aad))
* **spec:** reverse-DNS type ids, `-slide` dropped, and the evolution rule ([#506](https://github.com/jaapstronks/deckyard/issues/506)) ([dfe1f0b](https://github.com/jaapstronks/deckyard/commit/dfe1f0bdda696c0c5d407980b8514bcb6beac22f))


### Fixed

* **export:** anchor slide base font to theme, stop app-chrome font leaking into PDF ([37afb40](https://github.com/jaapstronks/deckyard/commit/37afb406b3313660f29a9366dc1990a0ba605cb3))
* **export:** inline local url() assets and blank unfetchable images ([#488](https://github.com/jaapstronks/deckyard/issues/488)) ([e3b43e1](https://github.com/jaapstronks/deckyard/commit/e3b43e1e5557df1877c4d2b5a8ccbc463c433728))
* **export:** stop blurred shadows reaching the PDF as luminosity masks ([#492](https://github.com/jaapstronks/deckyard/issues/492)) ([6e04a5c](https://github.com/jaapstronks/deckyard/commit/6e04a5c61ad62d67dd334f921de1e420be51f725))
* **i18n:** Dutch field labels for countdown/custom-html/embed/lead-capture/matrix/process slides ([#518](https://github.com/jaapstronks/deckyard/issues/518)) ([4d27091](https://github.com/jaapstronks/deckyard/commit/4d270919fdfb5eec20ea277375b741145059348e))
* **i18n:** one permission-label helper, Dutch comparison/timeline field labels ([#513](https://github.com/jaapstronks/deckyard/issues/513)) ([70c9eb8](https://github.com/jaapstronks/deckyard/commit/70c9eb84b4fcbb7fb246589f9a3e4bf00eb6f2e7))
* **organizations:** report invitations that were sent, administer the organization you are in ([#500](https://github.com/jaapstronks/deckyard/issues/500)) ([084601b](https://github.com/jaapstronks/deckyard/commit/084601bc89fd79879661803fa563009f096840ed))
* **slide-types:** a fork override of a core name reaches the browser ([#507](https://github.com/jaapstronks/deckyard/issues/507)) ([a77958c](https://github.com/jaapstronks/deckyard/commit/a77958cafa05735aff496a910c039aabd27a5abc))
* **theme:** declare the generated slide gradient where its coordinates live ([#493](https://github.com/jaapstronks/deckyard/issues/493)) ([8ba7a2e](https://github.com/jaapstronks/deckyard/commit/8ba7a2e3b973f5cad42690a957944b22032163e6))
* **title-slide:** stop left logo corner from shifting the title block ([eac3aeb](https://github.com/jaapstronks/deckyard/commit/eac3aeb602db83778bbdbdc629676c917baca48c))


### Changed

* **export:** cap PDF images at their display size, not source resolution ([#497](https://github.com/jaapstronks/deckyard/issues/497)) ([d83216f](https://github.com/jaapstronks/deckyard/commit/d83216f08a20a337b4c3c5677f29daca2a52e8f1))
* **export:** rasterize gradient slide backgrounds in the PDF export ([1181d7f](https://github.com/jaapstronks/deckyard/commit/1181d7f6880a4438e576cfb66d2f7f535e59ad03))
* **export:** rasterize visible gradient pseudo-element layers too ([#491](https://github.com/jaapstronks/deckyard/issues/491)) ([017c058](https://github.com/jaapstronks/deckyard/commit/017c05815664aea8d6d15d8eea7e16f436abca3a))

## [1.10.0](https://github.com/jaapstronks/deckyard/compare/v1.9.0...v1.10.0) (2026-07-30)


### Added

* **capture:** bilingual lemonade-stand sample deck for the marketing shots ([#454](https://github.com/jaapstronks/deckyard/issues/454)) ([1bdbacc](https://github.com/jaapstronks/deckyard/commit/1bdbacc331be53daf05068d28995abb653354684))
* **capture:** the tranche-1 marketing recipes, and three fixes they surfaced ([#456](https://github.com/jaapstronks/deckyard/issues/456)) ([1fc63d5](https://github.com/jaapstronks/deckyard/commit/1fc63d5a2c0ceb5fe53bdd954bbd65c6aa590c71))
* **deck-format:** point schema $id at deckyard.eu and license the spec under CC0 ([#441](https://github.com/jaapstronks/deckyard/issues/441)) ([cddf708](https://github.com/jaapstronks/deckyard/commit/cddf708dca698ab833562140adb8d62ca34d8473))
* **kpi-slide:** let a theme colour the KPI tiles through tokens ([#438](https://github.com/jaapstronks/deckyard/issues/438)) ([ed14676](https://github.com/jaapstronks/deckyard/commit/ed146762fc7de36b477f53ade45521ad6ad48737))
* **ops:** add maintenance mode so a deploy stops failing saves silently ([#447](https://github.com/jaapstronks/deckyard/issues/447)) ([23bf94f](https://github.com/jaapstronks/deckyard/commit/23bf94f8edee93ffb28f97505e027bc1781ad2fc))
* **organizations:** add an organization switcher to the user menu ([#446](https://github.com/jaapstronks/deckyard/issues/446)) ([33f231d](https://github.com/jaapstronks/deckyard/commit/33f231dc9318bfdbe42a67057a3b78d9320ddd7e))
* **organizations:** gate admin UI on the membership role of the active org ([#449](https://github.com/jaapstronks/deckyard/issues/449)) ([6be2c55](https://github.com/jaapstronks/deckyard/commit/6be2c5516f5bc260a44cce7bc1b00d3bc452c77d))
* **organizations:** manage the member list from the Users tab ([#486](https://github.com/jaapstronks/deckyard/issues/486)) ([3dcd05e](https://github.com/jaapstronks/deckyard/commit/3dcd05e62b28863f99fc0de1798d5230dc9c5678))
* **organizations:** the Users tab becomes the member list in multi-org ([#484](https://github.com/jaapstronks/deckyard/issues/484)) ([0503117](https://github.com/jaapstronks/deckyard/commit/0503117e72207428731e693e2a105daf1840846d))
* **scripts:** rename migration lijstje-slide → list-slide, on both stores ([#464](https://github.com/jaapstronks/deckyard/issues/464)) ([4e6f999](https://github.com/jaapstronks/deckyard/commit/4e6f999151c216a0de5fe40b065a4237f1ef6557))
* **slide-types:** assert no duplicate types and no lossy layout variants ([#457](https://github.com/jaapstronks/deckyard/issues/457)) ([5d56ae2](https://github.com/jaapstronks/deckyard/commit/5d56ae233eab370140cb98d52d56c54559f3a4fc))
* **slide-types:** declare the `runtime` facet so nine modules stop guessing ([#460](https://github.com/jaapstronks/deckyard/issues/460)) ([3cbfb32](https://github.com/jaapstronks/deckyard/commit/3cbfb32a323f8d5b99b596b2024b985eb715a6f1))
* **slide-types:** declare the `structure` facet and guard it in CI ([#453](https://github.com/jaapstronks/deckyard/issues/453)) ([dd42f93](https://github.com/jaapstronks/deckyard/commit/dd42f9376b81763f8fd1e83a1af78769a3266584))
* **slide-types:** derive the name-branching inventory so the matrix has no hole ([#458](https://github.com/jaapstronks/deckyard/issues/458)) ([e36b96e](https://github.com/jaapstronks/deckyard/commit/e36b96eddf9290dbba2494781ee824f42578f83e))
* **themes:** a green/brass brand theme, and it becomes the default ([#455](https://github.com/jaapstronks/deckyard/issues/455)) ([f239adf](https://github.com/jaapstronks/deckyard/commit/f239adfd82197ac250db4edc9be1b0c7fa282840))
* **video-slide:** let the author set the watch link shown in exports ([#434](https://github.com/jaapstronks/deckyard/issues/434)) ([67e55b2](https://github.com/jaapstronks/deckyard/commit/67e55b26008c2bc1be3297f1edf91588cbb6bd02))


### Fixed

* **comments:** recognise AI suggestions by the effective author identity ([#442](https://github.com/jaapstronks/deckyard/issues/442)) ([95da202](https://github.com/jaapstronks/deckyard/commit/95da202e251f9332c370a0531e1159dadf99af35))
* **deps:** reflect the optional dependency story in the manifest (B6-C4) ([#431](https://github.com/jaapstronks/deckyard/issues/431)) ([9184d21](https://github.com/jaapstronks/deckyard/commit/9184d2132921c2f64fb9ef0f90110765b7fd7f76))
* drop a stray node_modules symlink that rode along in [#460](https://github.com/jaapstronks/deckyard/issues/460) ([#461](https://github.com/jaapstronks/deckyard/issues/461)) ([09a9c63](https://github.com/jaapstronks/deckyard/commit/09a9c63e3c171bb78d5694efcf2457df4a3c057d))
* **editor:** stop redundant slide-list rebuilds from lock/comment SSE echoes ([#435](https://github.com/jaapstronks/deckyard/issues/435)) ([8f466a1](https://github.com/jaapstronks/deckyard/commit/8f466a12e71a590490adeb1fa07249fcc4f81284))
* **export:** render the video poster in PDF/PNG placeholders ([#433](https://github.com/jaapstronks/deckyard/issues/433)) ([a14922d](https://github.com/jaapstronks/deckyard/commit/a14922dbd38aeacb619780b30c8c63145ca6717f))
* **i18n:** detect duplicate keys in i18n:validate over raw lines ([#439](https://github.com/jaapstronks/deckyard/issues/439)) ([a1dfa9b](https://github.com/jaapstronks/deckyard/commit/a1dfa9bdcb6114e7bc0d53a1f666aa01108bd1cf))
* **slide-types:** make the aggregator seam registry-first, and put the companions on the wire ([#473](https://github.com/jaapstronks/deckyard/issues/473)) ([a83927e](https://github.com/jaapstronks/deckyard/commit/a83927ef0ae3e8162428cd06e1870535451a7e43))
* **slides:** three lemonade-stand defects — list alignment, nested-surface contrast, slide-copy language ([#463](https://github.com/jaapstronks/deckyard/issues/463)) ([fcf7a3a](https://github.com/jaapstronks/deckyard/commit/fcf7a3a7fd510107e7492efd7e86eae1b39a8994))
* **spec:** stop publishing legacy fields in the JSON Schema ([#452](https://github.com/jaapstronks/deckyard/issues/452)) ([3a2334b](https://github.com/jaapstronks/deckyard/commit/3a2334ba52e94237ace2c579f59cafc4167a6ed4))
* **storage:** stop partial writes from erasing deck columns ([#440](https://github.com/jaapstronks/deckyard/issues/440)) ([71f9a16](https://github.com/jaapstronks/deckyard/commit/71f9a16cd882c344237fa4803a8d47b3bbf5ada3))


### Changed

* **editor:** debounce the slide-search rerender ([#437](https://github.com/jaapstronks/deckyard/issues/437)) ([a5a8f3f](https://github.com/jaapstronks/deckyard/commit/a5a8f3f7429439be006848e46d61972271ae1589))
* **editor:** patch slide-list lock indicators in place instead of rebuilding ([#436](https://github.com/jaapstronks/deckyard/issues/436)) ([410986c](https://github.com/jaapstronks/deckyard/commit/410986c8f3b0e46277887c415077603e478cb688))
* **export:** ship viewer CSS, not the 630 KB editor bundle ([#462](https://github.com/jaapstronks/deckyard/issues/462)) ([b9dd8a2](https://github.com/jaapstronks/deckyard/commit/b9dd8a23ea650da0f46b1a575276df313fbf0000))
* **thumbnails:** warm the deck raster on save, debounced per deck ([#426](https://github.com/jaapstronks/deckyard/issues/426)) ([5bbc8a2](https://github.com/jaapstronks/deckyard/commit/5bbc8a2781aa6dc60376cb47c644eb8376c26717))
* **slide-types:** retire the `lijstje-slide` alias; built-in types go from 37 to 36. It was a second name for `list-slide`, never a second type. Stored decks are renamed automatically on upgrade by database migration `056`; file-store installs run `node scripts/migrate-lijstje-slide.js`. Anything missed renders as an archived slide pointing at `list-slide`, not as a broken one ([#485](https://github.com/jaapstronks/deckyard/issues/485)) ([0fb97b7](https://github.com/jaapstronks/deckyard/commit/0fb97b791eb80a944e77dd31c98e44c725f198e9))

## [1.9.0](https://github.com/jaapstronks/deckyard/compare/v1.8.0...v1.9.0) (2026-07-27)


### Added

* **lint:** add advisory dead-CSS-selector scanner ([#424](https://github.com/jaapstronks/deckyard/issues/424)) ([3c48ed1](https://github.com/jaapstronks/deckyard/commit/3c48ed168ef9aa9f4ea6455612d8b0f5fb9b9d4a))
* **table-slide:** add cornerCell to colour the whole top row ([#418](https://github.com/jaapstronks/deckyard/issues/418)) ([ac15833](https://github.com/jaapstronks/deckyard/commit/ac15833c4633acd7802d749c2902e68f2b7061c0))


### Fixed

* **ai:** accept rows[]-canonical text-blocks slides in the refine schema ([#420](https://github.com/jaapstronks/deckyard/issues/420)) ([0bee87e](https://github.com/jaapstronks/deckyard/commit/0bee87e0cbd53169861ad5a3c1ab929e2d329351))
* **slide-locks:** make acquire atomic to stop a delete-then-insert 500 ([#423](https://github.com/jaapstronks/deckyard/issues/423)) ([a30996a](https://github.com/jaapstronks/deckyard/commit/a30996abfa8f6e13a1f7394a9b0cda12a093ce58))
* **thumbnails:** stop invalidating deck rasters on unrelated saves ([#422](https://github.com/jaapstronks/deckyard/issues/422)) ([87ca965](https://github.com/jaapstronks/deckyard/commit/87ca9654d3418b75b2174abd6d519ea2e8ec44e2))

## [1.8.0](https://github.com/jaapstronks/deckyard/compare/v1.7.1...v1.8.0) (2026-07-27)


### Added

* **text-blocks:** allow a fourth row ([#417](https://github.com/jaapstronks/deckyard/issues/417)) ([d5fbd40](https://github.com/jaapstronks/deckyard/commit/d5fbd4039cb32d936a17c19289bb6577fe3d977c))


### Fixed

* **list-slide:** stop dropping "Large" and fill the slide ([#414](https://github.com/jaapstronks/deckyard/issues/414)) ([c344b54](https://github.com/jaapstronks/deckyard/commit/c344b54ffbdb682dd7681cd400df0a0c2b64065d))
* **quote-slide:** remove the quote typewriter effect ([#416](https://github.com/jaapstronks/deckyard/issues/416)) ([a71f036](https://github.com/jaapstronks/deckyard/commit/a71f036b92cfe8ddf781b5ecbc9155dc7f37c5eb))

## [1.7.1](https://github.com/jaapstronks/deckyard/compare/v1.7.0...v1.7.1) (2026-07-27)


### Fixed

* **process-slide:** top-align the steps in the horizontal layout ([#411](https://github.com/jaapstronks/deckyard/issues/411)) ([67d84d7](https://github.com/jaapstronks/deckyard/commit/67d84d7e1db02329ac6aa4e9b09d790c8982988f))

## [1.7.0](https://github.com/jaapstronks/deckyard/compare/v1.6.0...v1.7.0) (2026-07-27)


### Added

* **deck-format:** name the interchange format deckyard.deck ([#410](https://github.com/jaapstronks/deckyard/issues/410)) ([e5397c3](https://github.com/jaapstronks/deckyard/commit/e5397c3654bba28574ff0dbd8f79f929fff4e034))
* **slide-types:** derive the agent-facing schema from the registry ([#407](https://github.com/jaapstronks/deckyard/issues/407)) ([a194159](https://github.com/jaapstronks/deckyard/commit/a1941599b898f7db8c4060cc81949dd1d1a288da))


### Fixed

* **export:** return Node Buffers from headless Chrome, guard with a smoke test ([#404](https://github.com/jaapstronks/deckyard/issues/404)) ([d458ad9](https://github.com/jaapstronks/deckyard/commit/d458ad97dd1d63a164ffb1b98ef01811a3fe6ef2))

## [1.6.0](https://github.com/jaapstronks/deckyard/compare/v1.5.1...v1.6.0) (2026-07-26)


### Added

* **export:** add ?ui=min to the standalone export runtime ([8312d4e](https://github.com/jaapstronks/deckyard/commit/8312d4e958e400113bb7811464ca49423c1e62ca))


### Fixed

* **export:** load Prism, KaTeX and player.js only when a deck needs them ([14d239c](https://github.com/jaapstronks/deckyard/commit/14d239c4d49037b8e9ab54f5f503748291f44190))

## [1.5.1](https://github.com/jaapstronks/deckyard/compare/v1.5.0...v1.5.1) (2026-07-26)


### Fixed

* **ai:** adopt zod 4 and read ZodError.issues ([ffac67e](https://github.com/jaapstronks/deckyard/commit/ffac67e2bd8f75ec5f66cab1ff3336aeb39a48a5))

## [1.5.0](https://github.com/jaapstronks/deckyard/compare/v1.4.1...v1.5.0) (2026-07-26)


### Added

* **theme:** one contrast implementation, three consumers, and a readout ([#397](https://github.com/jaapstronks/deckyard/issues/397)) ([105dd3f](https://github.com/jaapstronks/deckyard/commit/105dd3f227f4be5062c7163caebd51297680c146))


### Fixed

* **theme:** pick text colour by contrast ratio, not luminance midpoint ([#396](https://github.com/jaapstronks/deckyard/issues/396)) ([3f2a2d7](https://github.com/jaapstronks/deckyard/commit/3f2a2d75f07ed8642743c4bb494d00bbab6f2be4))

## [1.4.1](https://github.com/jaapstronks/deckyard/compare/v1.4.0...v1.4.1) (2026-07-26)


### Fixed

* **api:** give SSE error events one shape, distinct from the HTTP envelope ([#362](https://github.com/jaapstronks/deckyard/issues/362)) ([7411843](https://github.com/jaapstronks/deckyard/commit/7411843f25e9492b8490536ae7e00cf86df4718a))

## [1.4.0](https://github.com/jaapstronks/deckyard/compare/v1.3.0...v1.4.0) (2026-07-26)


### ⚠ BREAKING CHANGES

* the `freeform-slide` type is no longer registered. Slides stored with `type: "freeform-slide"` render the generic unknown-type placeholder instead of their canvas; their content remains in the deck JSON.

### Added

* **editor:** split the inspector background by frequency, drop the header row ([#393](https://github.com/jaapstronks/deckyard/issues/393)) ([5a842e4](https://github.com/jaapstronks/deckyard/commit/5a842e47f16996ccadf818b7ff3cb265f6aec782))
* **mcp:** derive get_slide_types from the registry, not the AI catalog ([#386](https://github.com/jaapstronks/deckyard/issues/386)) ([84f87d3](https://github.com/jaapstronks/deckyard/commit/84f87d3696202451c44bb4720d9a8ed4a09c7bd1))
* **slide-types:** gate companion coverage so a type cannot drift silently ([#388](https://github.com/jaapstronks/deckyard/issues/388)) ([b9b18ee](https://github.com/jaapstronks/deckyard/commit/b9b18eee395f07d4dfc3033969d514ed9bdf2aaa))
* **slide-types:** give a removed slide type a real render contract ([#384](https://github.com/jaapstronks/deckyard/issues/384)) ([e1eb3d9](https://github.com/jaapstronks/deckyard/commit/e1eb3d9e2d87d2f46ba1ade9c2b6bea7b277e49b))
* **slide-types:** let a type carry its own usage rules for agents ([#390](https://github.com/jaapstronks/deckyard/issues/390)) ([b1f79a0](https://github.com/jaapstronks/deckyard/commit/b1f79a041c989d2aa201a5d5026debb8be5cf5ef))


### Fixed

* **export:** repair broken #slide=&lt;n&gt; deep-link in exported HTML ([#391](https://github.com/jaapstronks/deckyard/issues/391)) ([ba8dadc](https://github.com/jaapstronks/deckyard/commit/ba8dadce470c02419e312c8559db32ad05a87bfc))


### Changed

* cap the version at 1.x while Deckyard is in beta ([18701a4](https://github.com/jaapstronks/deckyard/commit/18701a4adf586316895c5d7bc0f411224c9e8e6d))
* remove the deprecated freeform slide type ([#377](https://github.com/jaapstronks/deckyard/issues/377)) ([e12a0ee](https://github.com/jaapstronks/deckyard/commit/e12a0ee7263a669bd283620c9557a9835256f7d3))

## [1.3.0](https://github.com/jaapstronks/deckyard/compare/v1.2.0...v1.3.0) (2026-07-25)


### Added

* **auth:** bind each request to the organization its session resolved to ([#356](https://github.com/jaapstronks/deckyard/issues/356)) ([ddab92f](https://github.com/jaapstronks/deckyard/commit/ddab92f90501d0c5ffc5df1fb9d11719e05fe42f))
* **auth:** make the presentation authorization layer organization-aware ([#359](https://github.com/jaapstronks/deckyard/issues/359)) ([2f8e823](https://github.com/jaapstronks/deckyard/commit/2f8e8230ba62c927e41bcb59072088e807734187))
* **auth:** resolve identity independently of organization ([#349](https://github.com/jaapstronks/deckyard/issues/349)) ([20cb58f](https://github.com/jaapstronks/deckyard/commit/20cb58f0b80918af7697ca591bc892a38667a16d))
* **slide-types:** make alignment a property of the block, not of each field ([#365](https://github.com/jaapstronks/deckyard/issues/365)) ([a1c8349](https://github.com/jaapstronks/deckyard/commit/a1c8349c993726ede5715587f6bca78d25570fd3))


### Fixed

* **api:** route optimistic-lock errors through the canonical envelope ([#361](https://github.com/jaapstronks/deckyard/issues/361)) ([b4de3a3](https://github.com/jaapstronks/deckyard/commit/b4de3a3a8c304e38876fe4f2ff4310a1fa56f192))
* **card-stack:** derive the fallback palette from theme tokens ([#364](https://github.com/jaapstronks/deckyard/issues/364)) ([676135e](https://github.com/jaapstronks/deckyard/commit/676135eb2e1a8331c340ae6c17cccc8f1b42aac0))
* **client:** stop listeners, timers and streams outliving their view ([#343](https://github.com/jaapstronks/deckyard/issues/343)) ([76ea389](https://github.com/jaapstronks/deckyard/commit/76ea389618abf9dea1dd3b888c4646bf1aa450c5))
* **i18n:** default a new deck's language to the UI locale ([#360](https://github.com/jaapstronks/deckyard/issues/360)) ([d5df6ed](https://github.com/jaapstronks/deckyard/commit/d5df6eda282183dceedb1951f40aac62bfc93bdb))
* **list:** guarantee the deck-grid shimmer always reaches a terminal state ([#363](https://github.com/jaapstronks/deckyard/issues/363)) ([4f28aff](https://github.com/jaapstronks/deckyard/commit/4f28aff6f376594e243a5ed5617e59068f1e86e4))


### Security

* escape user-authored content in editor innerHTML sinks (B8 slice 1) ([#370](https://github.com/jaapstronks/deckyard/issues/370)) ([1e6267c](https://github.com/jaapstronks/deckyard/commit/1e6267cb8c8292e18ef644445aece07a17bdeede))

## [1.2.0](https://github.com/jaapstronks/deckyard/compare/v1.1.0...v1.2.0) (2026-07-24)


### Added

* **i18n:** audit hardcoded copy and gate it in CI ([#335](https://github.com/jaapstronks/deckyard/issues/335)) ([c1ea16d](https://github.com/jaapstronks/deckyard/commit/c1ea16dbb17e15c5086c4f4542c674cce3df883a))


### Fixed

* **editor:** route json-debug invalid-JSON toast through t() ([#332](https://github.com/jaapstronks/deckyard/issues/332)) ([459ce4b](https://github.com/jaapstronks/deckyard/commit/459ce4b26849710f9a0ee01c0282d4b6df5c2c18))


### Security

* **sandbox:** launch-hardening PR 1 — proxy trust, per-guest quota, CSS-bg SSRF net ([#334](https://github.com/jaapstronks/deckyard/issues/334)) ([e4b12aa](https://github.com/jaapstronks/deckyard/commit/e4b12aaf15ce5c5e0d8aa4cab48a2fcf8b15ac62))

## [1.1.0](https://github.com/jaapstronks/deckyard/compare/v1.0.0...v1.1.0) (2026-07-24)


### Added

* **a11y/seo:** HTML semantics audit — landmarks, native lists, RTL, meta/JSON-LD ([#247](https://github.com/jaapstronks/deckyard/issues/247)) ([46d018f](https://github.com/jaapstronks/deckyard/commit/46d018f44185f5f740a47b5120334b27c7d5bdeb))
* **a11y:** nested document heading outline for visual export/embed (tier 3) ([#251](https://github.com/jaapstronks/deckyard/issues/251)) ([4b2760f](https://github.com/jaapstronks/deckyard/commit/4b2760f71d1c662206df39d53835fd576329fe87))
* **activity:** a bundled slide.added feed event ([#84](https://github.com/jaapstronks/deckyard/issues/84)) ([b6b79c5](https://github.com/jaapstronks/deckyard/commit/b6b79c50a613ab71a65a97949d357355a493e9ba))
* **activity:** slide-preview thumb next to comments in the "from others" rail ([#86](https://github.com/jaapstronks/deckyard/issues/86)) ([2f8ffa0](https://github.com/jaapstronks/deckyard/commit/2f8ffa0cdde4110d5462ef34f759021fa099cbd7))
* **ai-review:** click-to-preview grid, hover-select, peek nav ([#115](https://github.com/jaapstronks/deckyard/issues/115)) ([b6ccee2](https://github.com/jaapstronks/deckyard/commit/b6ccee26febfc4c381095f884089625cea036b0b))
* **api,mcp:** comments via public API v1 + MCP write tools ([6b96292](https://github.com/jaapstronks/deckyard/commit/6b962925b15fc3f324ff70899e283be3c16f5596))
* **auth:** self-hosted single-IdP SSO via OIDC (Track 1) ([#280](https://github.com/jaapstronks/deckyard/issues/280)) ([780c074](https://github.com/jaapstronks/deckyard/commit/780c0740177dfc2192f54aef30929e69326208f7))
* **branding:** configurable app name (APP_NAME) + help/docs link (HELP_URL) ([#58](https://github.com/jaapstronks/deckyard/issues/58)) ([1234f7f](https://github.com/jaapstronks/deckyard/commit/1234f7fb16cd3419c02187d25ae137d9a0f9997f))
* **builds:** typewriter-per-bullet reveal style (build-animations phase 1) ([#263](https://github.com/jaapstronks/deckyard/issues/263)) ([f92049a](https://github.com/jaapstronks/deckyard/commit/f92049a5142d0aa7bb559684eb7d069e43504984))
* **capture:** deterministic docs screenshot factory (Phase 0) ([#324](https://github.com/jaapstronks/deckyard/issues/324)) ([499e568](https://github.com/jaapstronks/deckyard/commit/499e568c5e41c775869a08f04aa291eb55c79221))
* **chart:** chart-data editing moves to a bottom-panel "Data" tab ([f2573db](https://github.com/jaapstronks/deckyard/commit/f2573dbfda025cfb603bc6f21bd07cc91fd9af40))
* **chart:** chart-data editor as a roomy modal with live preview ([#210](https://github.com/jaapstronks/deckyard/issues/210)) ([2776dd7](https://github.com/jaapstronks/deckyard/commit/2776dd7d86db261edf563f70fb2506e8ad80dfb6))
* **chart:** spreadsheet keyboard-nav + smarter header-cell paste ([#127](https://github.com/jaapstronks/deckyard/issues/127)) ([b765edb](https://github.com/jaapstronks/deckyard/commit/b765edb7b6efb0180d98831eeae49ce2d5d6e143))
* **chart:** spreadsheet-style data grid editor with raw-CSV toggle ([#121](https://github.com/jaapstronks/deckyard/issues/121)) ([868eb94](https://github.com/jaapstronks/deckyard/commit/868eb94c7781ceb0903e21bfb6e1391f44694366))
* **collab:** deck ⇄ Y.Doc codec — CRDT schema + serializer (fase 2, stap 1) ([#7](https://github.com/jaapstronks/deckyard/issues/7)) ([ca1a69b](https://github.com/jaapstronks/deckyard/commit/ca1a69baedd3089380f63fd9cf3d40c3a1ca43e2))
* **collab:** editor live-doc binder - Y.Doc as write target (fase 2, stap 3) ([#9](https://github.com/jaapstronks/deckyard/issues/9)) ([38b0946](https://github.com/jaapstronks/deckyard/commit/38b09460438292740062fcae05394346082af131))
* **collab:** presence round 2 - notes co-typing, presence on all edit surfaces, robust focus state ([#14](https://github.com/jaapstronks/deckyard/issues/14)) ([a491b4a](https://github.com/jaapstronks/deckyard/commit/a491b4a327cc2270eef75a02591b9e304800a0e6))
* **collab:** presence round 3 — gliding slide-list labels + fallback focus chip ([#17](https://github.com/jaapstronks/deckyard/issues/17)) ([0730cf3](https://github.com/jaapstronks/deckyard/commit/0730cf3b43adc187039e4265cedbfce1bb11d648))
* **collab:** server-as-collaborator - facade writes reach the live doc (fase 2, stap 4) ([#10](https://github.com/jaapstronks/deckyard/issues/10)) ([332e53a](https://github.com/jaapstronks/deckyard/commit/332e53a890abb85a9ac90ca7e0f4ced0091c18d0))
* **collab:** step-5 finish - conflict-semantics tests, lock retirement, revision hygiene (fase 2, stap 5) ([#11](https://github.com/jaapstronks/deckyard/issues/11)) ([af6cc6c](https://github.com/jaapstronks/deckyard/commit/af6cc6c4522f13afc11fd5a9c881a479088aae43))
* **collab:** Y.Doc persistence — storage adapters + Hocuspocus hooks (fase 2, stap 2) ([#8](https://github.com/jaapstronks/deckyard/issues/8)) ([bd18db9](https://github.com/jaapstronks/deckyard/commit/bd18db9e672393855243e49fe4e816b969230e51))
* **comments:** [@mentions](https://github.com/mentions) met autocomplete + toegangs-prompt (fase 3) ([da04498](https://github.com/jaapstronks/deckyard/commit/da044982103a77fc2846a9128bfcf2e91b76f238))
* **comments:** [@mentions](https://github.com/mentions) met inline autocomplete, toegangs-prompt en comment_mention-notificatie ([0dec0b6](https://github.com/jaapstronks/deckyard/commit/0dec0b6b71befaa66a20f39824a5653b00c000ce))
* **comments:** comment-activiteit voedt de notificatie-bel, bel ook in de editor ([04aa0a2](https://github.com/jaapstronks/deckyard/commit/04aa0a289356c553e3b0b905ea8fac72f2885b66))
* **comments:** comments voeden de bel + bel in de editor-topbar (fase 1) ([628c7f0](https://github.com/jaapstronks/deckyard/commit/628c7f02089b6a22228294f18ac1ebfa7c34f311))
* **comments:** link button in the composer ([#167](https://github.com/jaapstronks/deckyard/issues/167)) ([c054a5c](https://github.com/jaapstronks/deckyard/commit/c054a5ce079532fcbb23d6f12815f8dc84b1a51e))
* **comments:** per-user leesstatus + 'wacht op mij'-filter (fase 2) ([c2324ee](https://github.com/jaapstronks/deckyard/commit/c2324eecf915c2644b45f329081fbeaeeadd5287))
* **comments:** per-user leesstatus met unread-dots en 'wacht op mij'-filter ([170c6fe](https://github.com/jaapstronks/deckyard/commit/170c6feed72ae0dc661e4acc3a3bfd319d3df196))
* **comments:** render [@mention](https://github.com/mention) markers as inline chips everywhere ([#105](https://github.com/jaapstronks/deckyard/issues/105)) ([66fe50d](https://github.com/jaapstronks/deckyard/commit/66fe50d54b9fdf97652192642b5308de1c55da89))
* **comments:** show mentions as chips while typing ([#163](https://github.com/jaapstronks/deckyard/issues/163)) ([baccbf9](https://github.com/jaapstronks/deckyard/commit/baccbf910e445b98f7260a5f0932544fa4d2c1d2))
* **comments:** subscriptions + voorkeuren (fase 4) ([e6cb5cf](https://github.com/jaapstronks/deckyard/commit/e6cb5cf5ae40eb2b1920e798dd4fcfa9735fdc83))
* **comments:** subscriptions à la GitHub - participating default, per-deck override, voorkeuren ([9cc9f21](https://github.com/jaapstronks/deckyard/commit/9cc9f21537e8e0bad5373128b6a78a5009ef496a))
* **content-columns:** col{n}* image keys → ImageRef (datamodel step 4, laatste stap) ([89641b4](https://github.com/jaapstronks/deckyard/commit/89641b4270f9395ff68218b6a3b5550edd119fc5))
* **content-columns:** resolve col{n}* image keys into the ImageRef (datamodel step 4) ([678760c](https://github.com/jaapstronks/deckyard/commit/678760c20f0b2cf112a8647cf2bae4934dec365a))
* **create:** creation view + reuse consolidation (create-flow track, Slices 1-4) ([#76](https://github.com/jaapstronks/deckyard/issues/76)) ([78d9439](https://github.com/jaapstronks/deckyard/commit/78d9439728243166af2631ab217903386c6445d4))
* **data-model:** .deck bundle import / re-hydrate (PR 5b) ([#219](https://github.com/jaapstronks/deckyard/issues/219)) ([02786e8](https://github.com/jaapstronks/deckyard/commit/02786e80b84383b1885d426aeeea2ea19ec1337a))
* **data-model:** declare field-type vocabulary as single source (move 1a) ([ad32de7](https://github.com/jaapstronks/deckyard/commit/ad32de7706df19ae6cba126191d67d7fb236501b))
* **data-model:** field-type vocabulary as single source (move 1a) ([2a59898](https://github.com/jaapstronks/deckyard/commit/2a5989846ea805b51b38b2fefdcaff7f79712f7a))
* **data-model:** generate + serve the deck JSON Schema (move 1c) ([#213](https://github.com/jaapstronks/deckyard/issues/213)) ([a3f1e21](https://github.com/jaapstronks/deckyard/commit/a3f1e216a908c3cd04f97ac5b719fbbe07c2164c))
* **data-model:** pull markdown dialect toward CommonMark (PR 9) ([#215](https://github.com/jaapstronks/deckyard/issues/215)) ([6e7fbe2](https://github.com/jaapstronks/deckyard/commit/6e7fbe2c15227612b19a2039a87ddc1392311c0c))
* **data-model:** schemaVersion stamp + single migration runner (move 1b) ([#212](https://github.com/jaapstronks/deckyard/issues/212)) ([7a8e444](https://github.com/jaapstronks/deckyard/commit/7a8e44476760727eff448050838eaa6b80d5b247))
* **data-model:** self-contained .deck bundle export (PR 5a) ([#218](https://github.com/jaapstronks/deckyard/issues/218)) ([f049699](https://github.com/jaapstronks/deckyard/commit/f049699c5f2efa04ab736379ffc7a9d0dabd0790))
* **data-model:** semantic reflowable HTML reader export (PR 7) ([#217](https://github.com/jaapstronks/deckyard/issues/217)) ([af81b14](https://github.com/jaapstronks/deckyard/commit/af81b14b6608d5f04c3d5bcb77f0b8ae2195cc47))
* **data-model:** slide-type identity, namespaces + collision detection (PR 6) ([#216](https://github.com/jaapstronks/deckyard/issues/216)) ([e6704b6](https://github.com/jaapstronks/deckyard/commit/e6704b69c83e4f9ea84cda5e8cc66c1152c3a911))
* **editor:** "Settings" chip on images opens the inspector to their section ([#173](https://github.com/jaapstronks/deckyard/issues/173)) ([beeac1f](https://github.com/jaapstronks/deckyard/commit/beeac1f4b2bad278940520828ca168bb3b5fcb88))
* **editor:** clickable empty image slots - add a first image from the slide ([#24](https://github.com/jaapstronks/deckyard/issues/24)) ([03a0ac0](https://github.com/jaapstronks/deckyard/commit/03a0ac0ea30bd6f65bc2151639c8c8d2278d7d7a))
* **editor:** comments-pane krijgt scope-switch, filters worden één dropdown ([4a870e4](https://github.com/jaapstronks/deckyard/commit/4a870e4f53129678f028f8ce70617978b14d2938))
* **editor:** Cover/Contain fit toggle on images (wysiwyg) ([#172](https://github.com/jaapstronks/deckyard/issues/172)) ([42cf3b3](https://github.com/jaapstronks/deckyard/commit/42cf3b34a8e347f7e2d8093170244a03634e32ad))
* **editor:** drag & drop image files onto empty canvas placeholders ([cac98c4](https://github.com/jaapstronks/deckyard/commit/cac98c4621c35e38dbbdbf4de389f7dd54268de0))
* **editor:** drag & drop image files onto empty canvas placeholders ([a1ebe4d](https://github.com/jaapstronks/deckyard/commit/a1ebe4d16dba3494a3ce04c5d346095938dd6e8e))
* **editor:** draggable focal point on cropped images ([#171](https://github.com/jaapstronks/deckyard/issues/171)) ([39525eb](https://github.com/jaapstronks/deckyard/commit/39525eb1f8f308a3bc8b9a8335fd912796605dff))
* **editor:** finish selection-aware inspector — image-text per-image focus + content-columns element tab ([55a4c22](https://github.com/jaapstronks/deckyard/commit/55a4c2221d6cb53f364742d11e7a2be09a429122))
* **editor:** finish selection-aware inspector (image-text focus + content-columns element tab) ([2b3a730](https://github.com/jaapstronks/deckyard/commit/2b3a7307e46efb832681593cc5f46d3407757d61))
* **editor:** flag empty required fields in the form, not just on save ([00d78fc](https://github.com/jaapstronks/deckyard/commit/00d78fcdaf75ee19eb63711ef7face615cca5882))
* **editor:** focal point + fit on per-item images (gallery, team-cards, content-columns) ([#176](https://github.com/jaapstronks/deckyard/issues/176)) ([eb55c2e](https://github.com/jaapstronks/deckyard/commit/eb55c2ef6e1181446547c46dc7c67979f6ba8e0b))
* **editor:** icon-cards krijgen een inline icon-picker op de canvas ([63239d8](https://github.com/jaapstronks/deckyard/commit/63239d82e312f9c6d98eb0dba77c59183786bd9e))
* **editor:** images single-source in the inspector (retire pill/chip/popover) ([ef4dd9b](https://github.com/jaapstronks/deckyard/commit/ef4dd9be6d870b18ca8806afbd55f9de39d45767))
* **editor:** inline card reorder via overlay grip handles ([#23](https://github.com/jaapstronks/deckyard/issues/23)) ([d26ef3a](https://github.com/jaapstronks/deckyard/commit/d26ef3a71a844e1b3d5ba06f9b0ec445efb7c470))
* **editor:** inspector leidt met settings, grote per-type blokken inklapbaar ([d280a63](https://github.com/jaapstronks/deckyard/commit/d280a6346139b161319a51ab34984fcd012e555e))
* **editor:** keyboard-operable focal point (arrow keys + Home) ([d44f4eb](https://github.com/jaapstronks/deckyard/commit/d44f4ebe74a12a64d07f8f19b5d3a3d12bf959c5))
* **editor:** keyboard-operable focal point (arrow keys + Home) ([5cc226b](https://github.com/jaapstronks/deckyard/commit/5cc226bbb483a5b2e4c399a2f31d06a5df083b8b))
* **editor:** loading skeleton + faster deck open ([#19](https://github.com/jaapstronks/deckyard/issues/19)) ([7bb3e82](https://github.com/jaapstronks/deckyard/commit/7bb3e82a62bba9c83d9e6e781b08d909773bec0f))
* **editor:** notes under the slide, discoverable comment placement ([#64](https://github.com/jaapstronks/deckyard/issues/64)) ([402a169](https://github.com/jaapstronks/deckyard/commit/402a16923084e49eae108f9d5bc9f8053a698a2e))
* **editor:** Option A — full-width slide bar with labeled Inspector/Comments openers ([#149](https://github.com/jaapstronks/deckyard/issues/149)) ([72d014d](https://github.com/jaapstronks/deckyard/commit/72d014de7273fdf35b3d7936c66cc18fc5d1aa23))
* **editor:** presenter notes worden de derde inspector-pane ([fc0e872](https://github.com/jaapstronks/deckyard/commit/fc0e872d94a1bc8862bb3a5e2986ae6df1f552f0))
* **editor:** reflect the selected slide in the URL (?slideId=) ([726fd7f](https://github.com/jaapstronks/deckyard/commit/726fd7fc8d1090598b983bbb12662205a8ca2c44))
* **editor:** retire the 3x3 cover-focus grid from the inspector ([aa9c3e2](https://github.com/jaapstronks/deckyard/commit/aa9c3e27b1f3d64921cf58dc1b4fc280d630cdf9))
* **editor:** retire the 3x3 cover-focus grid from the inspector ([4d6c2f8](https://github.com/jaapstronks/deckyard/commit/4d6c2f8539d46dec8e98ba94ec8f4144e250a0e4))
* **editor:** selection-aware inspector with [This element | Slide] tabs ([#175](https://github.com/jaapstronks/deckyard/issues/175)) ([0868d2f](https://github.com/jaapstronks/deckyard/commit/0868d2f269b0f3ee5ad6c2a0de28e0035d375130))
* **editor:** show personal + team slides in insert-slide library strip ([008b1b9](https://github.com/jaapstronks/deckyard/commit/008b1b9407cb14de13dd56af091e1ad57b9422fa))
* **editor:** topbar in zones, gelabelde pane-switcher, slide-toolbar boven de canvas ([18f9c87](https://github.com/jaapstronks/deckyard/commit/18f9c87357843182fc644275adde15d1f1ad0474))
* **editor:** topbar wordt deck-only, pane-tabs verhuizen naar de slide-toolbar ([a4da34b](https://github.com/jaapstronks/deckyard/commit/a4da34b20e6a1cc61bab95ce276f4ecb9cc78321))
* **editor:** unified Background section + logo-wall 30-cap and colour ([#20](https://github.com/jaapstronks/deckyard/issues/20)) ([14a5314](https://github.com/jaapstronks/deckyard/commit/14a5314bee89625568eebe008503c5f21e9a03f0))
* **editor:** unify Share into one tabbed dialog; polish Export rows ([#164](https://github.com/jaapstronks/deckyard/issues/164)) ([27db530](https://github.com/jaapstronks/deckyard/commit/27db53037e92e1ce82c8731609dd7daa7787db62))
* **export:** compress images before embedding in server-side PDF ([f4bcd5d](https://github.com/jaapstronks/deckyard/commit/f4bcd5d37858edfb5c83a060575a682be3ad1549))
* **export:** unified export modal with colour-coded formats and one PDF entry ([#131](https://github.com/jaapstronks/deckyard/issues/131)) ([32917c9](https://github.com/jaapstronks/deckyard/commit/32917c9dc2cb42eb8ab8e34eb84222d1fd2a40ad))
* **follow:** collapsible Q&A so the slide fills a landscape phone ([#264](https://github.com/jaapstronks/deckyard/issues/264)) ([67953aa](https://github.com/jaapstronks/deckyard/commit/67953aafb03fdfd354b100c786a7827ea8d16819))
* **home:** building-blocks shelf replaces the theme-picker create zone ([#78](https://github.com/jaapstronks/deckyard/issues/78)) ([1a18ad0](https://github.com/jaapstronks/deckyard/commit/1a18ad03ddf9ca4265203b48fb8fc9c2b582d60f))
* **home:** coherent, content-first dashboard layout ([#63](https://github.com/jaapstronks/deckyard/issues/63)) ([f5d4fd1](https://github.com/jaapstronks/deckyard/commit/f5d4fd15b1f96acaeb92fbda4dbde1c637244446))
* **home:** per-user reuse tracking + "New to you" badge on the blocks shelf ([#81](https://github.com/jaapstronks/deckyard/issues/81)) ([d2b34fa](https://github.com/jaapstronks/deckyard/commit/d2b34fa57ce8e08f5ce00e2d0f7beb2e30092266))
* **home:** show comment text in the from-others rail; drop Popular's 0-count badge ([#80](https://github.com/jaapstronks/deckyard/issues/80)) ([3a15ee4](https://github.com/jaapstronks/deckyard/commit/3a15ee4714e7245c17f2821f3bc40bad976626ee))
* **home:** single /api/home aggregation replacing the client fan-out ([#83](https://github.com/jaapstronks/deckyard/issues/83)) ([75d9c11](https://github.com/jaapstronks/deckyard/commit/75d9c119e0af2f6ced006731e3eac38827db1e87))
* **home:** two-column canvas with a from-others activity rail ([#77](https://github.com/jaapstronks/deckyard/issues/77)) ([2b234fa](https://github.com/jaapstronks/deckyard/commit/2b234fa63c2be66ee138f3dbeea680694e218f64))
* **i18n:** honor ?lang=/?locale= URL param for initial UI locale ([#317](https://github.com/jaapstronks/deckyard/issues/317)) ([b94793c](https://github.com/jaapstronks/deckyard/commit/b94793cbfc46725043d6d56668327ed636d79b3c))
* **image-blocks:** justified rows for imageAspect: original ([#59](https://github.com/jaapstronks/deckyard/issues/59)) ([f61299b](https://github.com/jaapstronks/deckyard/commit/f61299b04eb639510e01337380bfccef54686947))
* **image-slide:** split conflated layout into ImageRef fit + bleed (datamodel step 3) ([ce57bdd](https://github.com/jaapstronks/deckyard/commit/ce57bdd145671fc2399ea0b07da99e42720d2aba))
* **image-slide:** split layout into ImageRef fit + bleed (datamodel step 3) ([940308c](https://github.com/jaapstronks/deckyard/commit/940308c235ee4304e54b53b9b0bd1fcfef9d3d6c))
* **image-text:** datamodel step 2 - fold focus + alt into the canonical ImageRef ([#182](https://github.com/jaapstronks/deckyard/issues/182) follow-up) ([#183](https://github.com/jaapstronks/deckyard/issues/183)) ([a12abb8](https://github.com/jaapstronks/deckyard/commit/a12abb86a5e4fe836baf9746ebf356786a4b8179))
* **image-text:** fit becomes an ImageRef property (datamodel step 2b) ([3d3b667](https://github.com/jaapstronks/deckyard/commit/3d3b667e7ecc3d42368547afed57dd504581d93d))
* **image-text:** layout-catalogus fase 1 - breedtereeks (1/3-2/3), hoekbeeld, layout-switcher ([bf9fdf5](https://github.com/jaapstronks/deckyard/commit/bf9fdf523d5aff28935896c77b8a242974d0711f))
* **image-text:** layout-catalogus fase 1 - breedtereeks, hoekbeeld, layout-switcher ([d3de142](https://github.com/jaapstronks/deckyard/commit/d3de142885202597ab10965e36342678b803cbd5))
* **image-text:** layout-catalogus fase 2 - beeldrijen, duo en de images[]-migratie ([c75ba88](https://github.com/jaapstronks/deckyard/commit/c75ba886d69b5cb1a45f59135859f0368483a5f5))
* **image-text:** layout-catalogus fase 2 - beeldrijen, duo en de images[]-migratie ([a1e4593](https://github.com/jaapstronks/deckyard/commit/a1e45939c99306db0629ed41a2d9e3bb07783de3))
* **image-text:** layout-catalogus fase 3 - cross-type tegels, spiegel-toggle en polish ([1d8813a](https://github.com/jaapstronks/deckyard/commit/1d8813a883bb46aa58883444c17bcbe7001ce988))
* **image-text:** layout-catalogus fase 3 - cross-type tegels, spiegel-toggle en polish ([bb5de58](https://github.com/jaapstronks/deckyard/commit/bb5de5889d000b67c5b4953a5a04372bff1d5772))
* **image-text:** optionele twee tekstkolommen bij beeldrij en duo ([2824349](https://github.com/jaapstronks/deckyard/commit/2824349424329804cf99f9ab89d9ea2e4a49eb92))
* **image-text:** optionele twee tekstkolommen bij beeldrij en duo ([35ae672](https://github.com/jaapstronks/deckyard/commit/35ae672ffa98b0f35692e55bce7edf678d3942d1))
* **image-text:** unify fit CSS + move fit onto the ImageRef (datamodel step 2b) ([45b0c0b](https://github.com/jaapstronks/deckyard/commit/45b0c0b0e0ad626cd0a46d1552f2e9710a4b5c09))
* **inline-edit:** block-level text alignment & colour ('This text' tab) ([d9be868](https://github.com/jaapstronks/deckyard/commit/d9be86876d5865380288b8f9dd2ac9b23071aa34))
* **inline-edit:** block-level text alignment & colour ('This text' tab) ([5e7f116](https://github.com/jaapstronks/deckyard/commit/5e7f116cb63ab6e87671c6ea436e2906b364eb2b))
* **inline-edit:** edit markdown fields in place on the canvas (editing-surfaces text phase 1) ([b4e673e](https://github.com/jaapstronks/deckyard/commit/b4e673e34ce106d51fb191a8f3f8f80815a5d6dc))
* **inline-edit:** floating selection toolbar for rich edits ([c9b9560](https://github.com/jaapstronks/deckyard/commit/c9b95607e75d14c949021884b0530e9191da2b09))
* **inline-edit:** floating selection toolbar for rich edits (editing-surfaces text, step 2) ([113900f](https://github.com/jaapstronks/deckyard/commit/113900f98ba651e1857d09188f61dc0830d337e3))
* **inline-edit:** image-picker parity for logo-wall, image-blocks, quote ([#148](https://github.com/jaapstronks/deckyard/issues/148)) ([adfe3b2](https://github.com/jaapstronks/deckyard/commit/adfe3b275a84cd8c1fb28d6e1c0347ba0bd67861))
* **inline-edit:** text-size scale (S/M/L) on the 'This text' tab ([#194](https://github.com/jaapstronks/deckyard/issues/194)) ([2f52f83](https://github.com/jaapstronks/deckyard/commit/2f52f83eb631d2036467f7e36b9bc5c1a850f5af))
* **inline-edit:** theme text swatches on the 'This text' colour control ([#199](https://github.com/jaapstronks/deckyard/issues/199)) ([4f499cd](https://github.com/jaapstronks/deckyard/commit/4f499cd22cf430fdf15484991788016bffd70b7f))
* **inspector:** enforce the element/slide split for image-text and image-slide ([e31d2a4](https://github.com/jaapstronks/deckyard/commit/e31d2a4e86f05cd949fba76551ecfa3f8cdae5fd))
* **inspector:** honest accessibility status chip + collapsible/flat rule ([#200](https://github.com/jaapstronks/deckyard/issues/200)) ([a6f025d](https://github.com/jaapstronks/deckyard/commit/a6f025d3be7069caa9b4998bb7975c8f2e7ba22a))
* **install:** agent-native install flow + non-interactive setup flags ([#284](https://github.com/jaapstronks/deckyard/issues/284)) ([c248d14](https://github.com/jaapstronks/deckyard/commit/c248d14579e60d9993de5e2ffd7c0299907e7644))
* **install:** one-command installer + interactive .env setup wizard ([#281](https://github.com/jaapstronks/deckyard/issues/281)) ([2ad0a07](https://github.com/jaapstronks/deckyard/commit/2ad0a077c614849e596e159a08783ac3f1bdc4be))
* **mcp:** read comments across decks (list_comments, list_recent_comments) ([#5](https://github.com/jaapstronks/deckyard/issues/5)) ([4e04c86](https://github.com/jaapstronks/deckyard/commit/4e04c86fd7dccace81c550a9a08311a57e78346f))
* **nav:** consolidate 9 sidebar items to 6 with a unified Presentations view ([#79](https://github.com/jaapstronks/deckyard/issues/79)) ([328e612](https://github.com/jaapstronks/deckyard/commit/328e612701550be93bb7e9166c7616a72b98e569))
* **notifications:** bundled "someone worked on your deck" notification ([#106](https://github.com/jaapstronks/deckyard/issues/106)) ([1108d32](https://github.com/jaapstronks/deckyard/commit/1108d32a0fa9b670df6875de312f3de3d38a81ed))
* **notifications:** events-inbox + auto-archive bij eigen reply (fase 5) ([c16886a](https://github.com/jaapstronks/deckyard/commit/c16886a3949ee78c6582b1f401a7783c3fff5dfb))
* **notifications:** events-inbox met archiveren, filters en auto-archive bij eigen reply ([8b4608a](https://github.com/jaapstronks/deckyard/commit/8b4608a6094b2393c78567b9e38d8b810fdf1c78))
* **pdf:** video slides export as 'watch online' placeholder ([#104](https://github.com/jaapstronks/deckyard/issues/104)) ([24cf8de](https://github.com/jaapstronks/deckyard/commit/24cf8dec227b6b90cc9a680db67ca8bab8bcf4e0))
* **picker:** schematic slide-type view + shared schematic renderer ([#134](https://github.com/jaapstronks/deckyard/issues/134)) ([44156bb](https://github.com/jaapstronks/deckyard/commit/44156bb86cfff4e4ff694708ca58913411fbaddd))
* **quote-slide:** canvas add/remove for 2nd/3rd quote + content-aware sizing ([#206](https://github.com/jaapstronks/deckyard/issues/206)) ([0a75f15](https://github.com/jaapstronks/deckyard/commit/0a75f15e4b908f7933fa3fe75b31130149b62773))
* **quote-slide:** edit-mode fixes, centre-align block, 2 portraits on extras ([#208](https://github.com/jaapstronks/deckyard/issues/208)) ([0e9232a](https://github.com/jaapstronks/deckyard/commit/0e9232ab533178f3de5e56b151eb47e0eb4ffc0b))
* **quote:** optional round portrait photos (1-2) next to the attribution ([#26](https://github.com/jaapstronks/deckyard/issues/26)) ([c83dc8a](https://github.com/jaapstronks/deckyard/commit/c83dc8a203c28ed9fbd8257fc974e13803fff084))
* **quote:** support up to 3 quotes with alternating alignment ([03fbbd1](https://github.com/jaapstronks/deckyard/commit/03fbbd147f6f2024d6d5452bd3403c2fce9e97d5))
* real-time collaboration — presence + live CRDT edits (ADR 001) ([#12](https://github.com/jaapstronks/deckyard/issues/12)) ([1c2860a](https://github.com/jaapstronks/deckyard/commit/1c2860a602207b51a22e5f45b0d1f54e4d790e1e))
* **sandbox:** example decks + focused Home, conditional ImageKit source ([4c265f4](https://github.com/jaapstronks/deckyard/commit/4c265f42c21c347ada63880245cdc1dc8238a30f))
* **sandbox:** explain agent-native instead of a dead 'connect an agent' CTA ([65101ce](https://github.com/jaapstronks/deckyard/commit/65101ceb617589b4e24a2b0524cbf114d5e3d0fd))
* **sandbox:** grey out irrelevant settings (export, notifications, digest) ([ea85c20](https://github.com/jaapstronks/deckyard/commit/ea85c20d951e0fa4e068f99eb7a082bbbbb313f4))
* **sandbox:** library explainer page + theme-picker production hint ([c5897ef](https://github.com/jaapstronks/deckyard/commit/c5897ef95a38f2c1ed948abdea3c52b27f3031db))
* **sandbox:** public-playground guards (publish off, banner, stock media) ([#290](https://github.com/jaapstronks/deckyard/issues/290)) ([ba4f3a9](https://github.com/jaapstronks/deckyard/commit/ba4f3a91e87985449dbca1b7da0bc72aab03bc4e))
* **sandbox:** sample media + logos in the image library, greyed source hint ([742ac4e](https://github.com/jaapstronks/deckyard/commit/742ac4e65562a976f8f9370d80984ee06645dcd6))
* **security:** fail closed on multi-workspace over a non-org-isolating backend ([#286](https://github.com/jaapstronks/deckyard/issues/286)) ([04c711e](https://github.com/jaapstronks/deckyard/commit/04c711ec0183492ea1e44d9eb5d9fe3d60965769))
* **self-install:** UX round 3 (cleaner Home, agent onboarding, MCP id alias, quiet locks) ([#291](https://github.com/jaapstronks/deckyard/issues/291)) ([8343ccd](https://github.com/jaapstronks/deckyard/commit/8343ccd38ebe8dc01fd94e1f360673cd7e28c772))
* **settings:** redesign the settings page as a real settings UI ([#147](https://github.com/jaapstronks/deckyard/issues/147)) ([2432f35](https://github.com/jaapstronks/deckyard/commit/2432f3532acba8d53c35f615999fbfd96f3fcd1f))
* **slide-types:** archive split-partner-title-slide ([#197](https://github.com/jaapstronks/deckyard/issues/197)) ([e5f78b8](https://github.com/jaapstronks/deckyard/commit/e5f78b80a12813f48b842905644f5d10f1952b6d))
* **slide-types:** count-aware semantic projection + url field type (2a substrate) ([#254](https://github.com/jaapstronks/deckyard/issues/254)) ([c2b6868](https://github.com/jaapstronks/deckyard/commit/c2b68681947c976a1f9dcd32210d279603ea930f))
* **slide-types:** drag-to-reorder custom types in settings ([4467c85](https://github.com/jaapstronks/deckyard/commit/4467c854e7089dc81038dfef14edb746f0197b2c))
* **slide-types:** full template syntax reference in the type editor ([86e6b0c](https://github.com/jaapstronks/deckyard/commit/86e6b0c193acb877de5dc090f7f1fa76cacd0b46))
* **slide-types:** import/export custom slide-type definitions ([#124](https://github.com/jaapstronks/deckyard/issues/124)) ([77d034b](https://github.com/jaapstronks/deckyard/commit/77d034bfa46a39cd60a55d9a82b9b93bf8348646))
* **slide-types:** migrate text-blocks to the nested rows model + relation-aware projection (PR B) ([#257](https://github.com/jaapstronks/deckyard/issues/257)) ([99946ae](https://github.com/jaapstronks/deckyard/commit/99946ae80783a11ebeca4625f8cccf08ea650ce9))
* **slide-types:** park lead-capture pending cookie-consent wiring ([#318](https://github.com/jaapstronks/deckyard/issues/318)) ([21b0ced](https://github.com/jaapstronks/deckyard/commit/21b0ced554a40dd7daa42db49226da6ff11ea8c5))
* **slide-types:** roll out text-role vocabulary, retire quote hardcode (PR 2) ([#226](https://github.com/jaapstronks/deckyard/issues/226)) ([7b5d2c6](https://github.com/jaapstronks/deckyard/commit/7b5d2c660af307b70066a6dc6353e6c5a7fe4596))
* **slide-types:** text-role affordance model, kill centered-bullet bug (PR 1) ([#225](https://github.com/jaapstronks/deckyard/issues/225)) ([f615cf0](https://github.com/jaapstronks/deckyard/commit/f615cf0be02a6baca8dfab4bdd4e80f6df6c248b))
* **slides:** layout setting + optional subheading on section title slide ([53e5f58](https://github.com/jaapstronks/deckyard/commit/53e5f58daea20e780606e12adf359a6eb7d3c268))
* **theme:** edit surfaces, heading treatment and locks in the theme editor ([#136](https://github.com/jaapstronks/deckyard/issues/136)) ([a2f19c4](https://github.com/jaapstronks/deckyard/commit/a2f19c47f760c90a4d5982a49dcd48f9ea864a1a))
* **theme:** enforce override locks at edit- and render-time ([#130](https://github.com/jaapstronks/deckyard/issues/130)) ([a529292](https://github.com/jaapstronks/deckyard/commit/a5292928d7d00a0826f42083363adda8d3b62e5d))
* **theme:** name background options in the theme editor ([#141](https://github.com/jaapstronks/deckyard/issues/141)) ([c99454e](https://github.com/jaapstronks/deckyard/commit/c99454e931f09a5abe4bccdfd28656b55319dab7))
* **theme:** name the two built-in backgrounds ([#142](https://github.com/jaapstronks/deckyard/issues/142)) ([a5dc830](https://github.com/jaapstronks/deckyard/commit/a5dc830e4af568630a93d6376f9e6a1f6c1c8c90))
* **theme:** preview real slides in the theme editor ([#133](https://github.com/jaapstronks/deckyard/issues/133)) ([26824e5](https://github.com/jaapstronks/deckyard/commit/26824e578cb22c5b69292021e2d60b6f68156555))
* **themes:** replace sandbox base themes with sharp archetype set ([#152](https://github.com/jaapstronks/deckyard/issues/152)) ([778cfbd](https://github.com/jaapstronks/deckyard/commit/778cfbd5372fe8eb662aa3574dbb879b2154a088))
* **theme:** store a rich config on database themes ([#120](https://github.com/jaapstronks/deckyard/issues/120)) ([c69bb6e](https://github.com/jaapstronks/deckyard/commit/c69bb6e5d9b97c852d103634e9723ca4e05bf2a4))
* **theme:** the theme owns its background presets ([#119](https://github.com/jaapstronks/deckyard/issues/119)) ([7355401](https://github.com/jaapstronks/deckyard/commit/7355401a26cf29dc0d62f3d9d4318fcbe64fd056))
* **theme:** upload background images to a theme from the editor ([#137](https://github.com/jaapstronks/deckyard/issues/137)) ([553afb7](https://github.com/jaapstronks/deckyard/commit/553afb7dcbf2e6248681e5680edd81007581ab4b))
* **theme:** wire theme surface tokens into the slide design system ([#129](https://github.com/jaapstronks/deckyard/issues/129)) ([b985c5f](https://github.com/jaapstronks/deckyard/commit/b985c5f1a64976ead7c2fe07f0c3865e77287c9f))
* **title-slide:** theme-driven layout (bottom/center/top) ([f864405](https://github.com/jaapstronks/deckyard/commit/f86440567677f57b4bc2f50de10230b75c95f676))
* **title-slide:** theme-driven layout (bottom/center/top) ([4bd9c63](https://github.com/jaapstronks/deckyard/commit/4bd9c6345461301dff03a443b5d90f868af87c58))
* **title-slide:** title/subtitle/meta field model + subtitle render fix ([349c73c](https://github.com/jaapstronks/deckyard/commit/349c73ca1d200dfe17c6e60798d39512cc4ac5fc))
* **title-slide:** title/subtitle/meta field model + subtitle render fix ([116e036](https://github.com/jaapstronks/deckyard/commit/116e036b1b0a68221dd98747148d7111fa64d5d6))
* **title-slide:** unify background onto shared slideBgImage ([#196](https://github.com/jaapstronks/deckyard/issues/196)) ([228c4c3](https://github.com/jaapstronks/deckyard/commit/228c4c37ca9e2fb33d02d2efbcb2676636d2e382))
* **ui:** Inter as the app-chrome sans, self-hosted with system fallback ([#135](https://github.com/jaapstronks/deckyard/issues/135)) ([b1ee8c8](https://github.com/jaapstronks/deckyard/commit/b1ee8c87d047ca58aeacebc4aecd6c66a2c65d9a))
* **ultrawide:** let a wide screen actually buy width ([#155](https://github.com/jaapstronks/deckyard/issues/155)) ([5b98e84](https://github.com/jaapstronks/deckyard/commit/5b98e8435c4690bd99725bf20894687afda11b8a))
* **wysiwyg:** afbeelding toevoegen/verwijderen als directe intentie (type-wissel text ↔ image-text) ([928de2e](https://github.com/jaapstronks/deckyard/commit/928de2e9401634e1ab4c922ca543f9e6f758d763))


### Fixed

* **ai-catalog:** expose image-grid slide types to the AI ([9bd9b3d](https://github.com/jaapstronks/deckyard/commit/9bd9b3d937ad00b3357e78e71599aa940d4c0218))
* **ai-catalog:** expose image-grid slide types to the AI ([233f416](https://github.com/jaapstronks/deckyard/commit/233f416fa8895d1dfc01dfa7650ada1fc98e07aa))
* **ai-prompts:** stop advertising buildThemeContextSection as overridable ([#203](https://github.com/jaapstronks/deckyard/issues/203)) ([57e8182](https://github.com/jaapstronks/deckyard/commit/57e8182712da261c522ac5818158a38e47b06866))
* **ai:** stop the catalog offering the deprecated content-columns-slide (F6) ([#323](https://github.com/jaapstronks/deckyard/issues/323)) ([f2127f8](https://github.com/jaapstronks/deckyard/commit/f2127f813b997c89a3b3e463062335001efdacfb))
* **analytics:** store slide IDs as text, not uuid ([7f8f833](https://github.com/jaapstronks/deckyard/commit/7f8f833f690e7b63c480f80f63e099413f0ac80e))
* **analytics:** store slide IDs as text, not uuid ([4727739](https://github.com/jaapstronks/deckyard/commit/472773977ada2d10ef5cfe2d501f1c3c1e04d16d))
* **api:** layoutVariants meesturen in /api/slide-types ([867f281](https://github.com/jaapstronks/deckyard/commit/867f2811c6f19a5518d77d8ec82c558d14caa70c))
* **api:** require If-Match for admins too on presentation writes ([#262](https://github.com/jaapstronks/deckyard/issues/262)) ([fc7deeb](https://github.com/jaapstronks/deckyard/commit/fc7deeb3292810979902951ca375a3394b73405f))
* **api:** unify the internal error envelope on a machine-code contract ([#261](https://github.com/jaapstronks/deckyard/issues/261)) ([34daeb0](https://github.com/jaapstronks/deckyard/commit/34daeb05c006cfc6bb22d613115f43282b2eb48c))
* **authz:** per-deck authorization for MCP tools and public API ([#6](https://github.com/jaapstronks/deckyard/issues/6)) ([9a29feb](https://github.com/jaapstronks/deckyard/commit/9a29feb8f1714ab41720b3cdd1eaed4ffce80efc))
* **authz:** stop leaking decks without view access on Home/overviews ([fb78386](https://github.com/jaapstronks/deckyard/commit/fb78386e5c183466761643ac4bc59e73aac0e90d))
* **chart:** route canvas chart click to the Data tab; tighten grid in panel ([d30362d](https://github.com/jaapstronks/deckyard/commit/d30362dbfc6ed54b0c508722994a876199458b2a))
* **collab:** presence label polish + clipping fix + stale slide-dot ([#15](https://github.com/jaapstronks/deckyard/issues/15)) ([f8d3cba](https://github.com/jaapstronks/deckyard/commit/f8d3cba95f469923cc05924401b2eb88589d9213))
* **collab:** review blockers - traversal, custom-html gate, load race, store consistency ([#13](https://github.com/jaapstronks/deckyard/issues/13)) ([6fcb513](https://github.com/jaapstronks/deckyard/commit/6fcb51364b06226f4ef5b859743da8db6b0361e6))
* **comments:** drop href on composer link nodes; document paren-URL limit ([#169](https://github.com/jaapstronks/deckyard/issues/169)) ([ba0bc8b](https://github.com/jaapstronks/deckyard/commit/ba0bc8b74063e5a91d2298085efc7a573ef664f8))
* **comments:** let presentation owner delete any comment on their deck ([#1](https://github.com/jaapstronks/deckyard/issues/1)) ([bee5661](https://github.com/jaapstronks/deckyard/commit/bee56614733518d41690b639aa973bebcad22ad5))
* **comments:** review-fixes op de notificatie-stack ([3c88c00](https://github.com/jaapstronks/deckyard/commit/3c88c000675c28b30ada6c30fb4424658bea8c85))
* **create:** active-tab highlight, optional theme in library, language up top ([#138](https://github.com/jaapstronks/deckyard/issues/138)) ([3ddc54d](https://github.com/jaapstronks/deckyard/commit/3ddc54dcf44cdbcb54faffd6372ca97dbea3ceaf))
* **css:** map analytics dashboard onto --app-* tokens (was undefined --ps-*) ([#316](https://github.com/jaapstronks/deckyard/issues/316)) ([d6e613f](https://github.com/jaapstronks/deckyard/commit/d6e613f5b2ef8b28b0a584192ab2f703319b054a))
* **css:** map auto-advance bar onto --app-* tokens (was undefined --ps-*) ([#314](https://github.com/jaapstronks/deckyard/issues/314)) ([032f5fa](https://github.com/jaapstronks/deckyard/commit/032f5fad21456ab6c06687869c0aebb87137f1e4))
* **css:** use the accent tokens that exist ([#146](https://github.com/jaapstronks/deckyard/issues/146)) ([3f50024](https://github.com/jaapstronks/deckyard/commit/3f50024f7ea803a684b5d033af7e77c81b751b3c))
* **data-model:** stop leaking owner email into public surfaces (move 3, narrow) ([#214](https://github.com/jaapstronks/deckyard/issues/214)) ([5b5b058](https://github.com/jaapstronks/deckyard/commit/5b5b0582d7e29b7eccfdedf002ac6e6548a69124))
* **editor:** clickable comment markers, whole-thread jump, dropdown factory ([#61](https://github.com/jaapstronks/deckyard/issues/61)) ([5945e5e](https://github.com/jaapstronks/deckyard/commit/5945e5ee0de81e18c9287fb2f55a100ab7a2af78))
* **editor:** close two low-frequency edge cases in cards and comments ([6810ccd](https://github.com/jaapstronks/deckyard/commit/6810ccd3a30a7ea2c56b8b25bede170590a7c74e))
* **editor:** grab-bag polish — search-focus, notes close, presence dot, card titles ([#60](https://github.com/jaapstronks/deckyard/issues/60)) ([f686743](https://github.com/jaapstronks/deckyard/commit/f6867439793af85e8080a51ed069c6819a7a6d7b))
* **editor:** keep the slide preview fully in view, no vertical scrollbar ([#66](https://github.com/jaapstronks/deckyard/issues/66)) ([660d8b8](https://github.com/jaapstronks/deckyard/commit/660d8b8511478f5fac7e4763c552632eca26bfe4))
* **editor:** preview-collapse-val weg, icon-cards remove-fix, bredere bulk-modal, hint-regel weg ([7a1560b](https://github.com/jaapstronks/deckyard/commit/7a1560b2d66260219f60e93dd4c09660b7d59cea))
* **editor:** rebuild element tab on image fit change so the cover-only focus grid toggles with the mode ([63b6bcc](https://github.com/jaapstronks/deckyard/commit/63b6bcc101994dd35ba6f1a4809e4d712eab6c96))
* **editor:** reserve "Layout" for the toolbar chip, dedup the naming ([#151](https://github.com/jaapstronks/deckyard/issues/151)) ([425e005](https://github.com/jaapstronks/deckyard/commit/425e005d9567e4e0a58a2274bbf51c9706110e70))
* **editor:** stop insert-row + button flickering on edge hover ([#65](https://github.com/jaapstronks/deckyard/issues/65)) ([bad18d4](https://github.com/jaapstronks/deckyard/commit/bad18d4591ea6cc7489025f799c9e8f39c94ecf5))
* **editor:** unify empty-image placeholders and gate the alt field ([#166](https://github.com/jaapstronks/deckyard/issues/166)) ([c59065a](https://github.com/jaapstronks/deckyard/commit/c59065a1d744a02f0050619683a1c8a84c7590f1))
* **editor:** WYSIWYG card add/remove + per-item affordance reveal + column-major 5-card grid ([#258](https://github.com/jaapstronks/deckyard/issues/258)) ([684ff0a](https://github.com/jaapstronks/deckyard/commit/684ff0adc87c085f92437e079c15cc8fa15fc004))
* **export:** embed local fonts in standalone HTML for offline rendering ([#108](https://github.com/jaapstronks/deckyard/issues/108)) ([60acae3](https://github.com/jaapstronks/deckyard/commit/60acae3f08a2e5dd85959a267c2eb3fb5d5dd1f9))
* **hardening:** prune rate-limit map + weak-config startup warnings ([#117](https://github.com/jaapstronks/deckyard/issues/117)) ([c422e57](https://github.com/jaapstronks/deckyard/commit/c422e570e3f6a803c0cd42a29aa6890d4f54ac2b))
* **i18n:** complete NL/EN coverage and make strings translatable ([#174](https://github.com/jaapstronks/deckyard/issues/174)) ([043cfae](https://github.com/jaapstronks/deckyard/commit/043cfae9bd0f33319c9f0d3d5f3963ea2a6c6729))
* **icon-card-grid:** make the tiles layout fill its grid, drop numbering ([1a98973](https://github.com/jaapstronks/deckyard/commit/1a989734081a6bddcd42e7c580a8a7fd86c00841))
* **icon-card-grid:** tint icons via CSS mask, not &lt;img&gt; currentColor ([#3](https://github.com/jaapstronks/deckyard/issues/3)) ([8639fcc](https://github.com/jaapstronks/deckyard/commit/8639fcc7a63b58d82d6d85c34b75a716d24c15dc))
* **image-text:** per-beeld cover-override wint ook van de multi-contain frame-regel ([f93bce6](https://github.com/jaapstronks/deckyard/commit/f93bce6cfdb513bb862d5255c7abf39a13497d5a))
* **inline-edit:** band-aware muted colour + drop the inverse token (rollout QA) ([#195](https://github.com/jaapstronks/deckyard/issues/195)) ([f3e248c](https://github.com/jaapstronks/deckyard/commit/f3e248c742ce4e9f77bd313505c6bc159ae59460))
* **inline-edit:** de-collide affordance chips across anchors ([#315](https://github.com/jaapstronks/deckyard/issues/315)) ([978296a](https://github.com/jaapstronks/deckyard/commit/978296ad242fa6bd4e1dbe6e4a50936be094c9e0))
* **inline-edit:** don't live-truncate rich edits via textContent ([37290ea](https://github.com/jaapstronks/deckyard/commit/37290eac7464469e7cd0b65141355e5c49c0ebfa))
* **inline-edit:** keep the + Subheading ghost chip off the first body line ([#114](https://github.com/jaapstronks/deckyard/issues/114)) ([faacd48](https://github.com/jaapstronks/deckyard/commit/faacd48457d321ae04e70244c75866aa6aa6a223)), closes [#113](https://github.com/jaapstronks/deckyard/issues/113)
* **inspector:** a11y heading proxy mirrors export's heading fields ([#202](https://github.com/jaapstronks/deckyard/issues/202)) ([f194be3](https://github.com/jaapstronks/deckyard/commit/f194be3346f5ffcfeac0a008da0390c015351c15))
* **inspector:** per-type coverage audit — no config field is bulk-only ([#192](https://github.com/jaapstronks/deckyard/issues/192)) ([c48ac43](https://github.com/jaapstronks/deckyard/commit/c48ac435d00733a65f1e601b0ed0249adc1ed035))
* **inspector:** surface video source and embed URL in the inspector ([098ab6e](https://github.com/jaapstronks/deckyard/commit/098ab6ea91db0d730667b85d3b553e53774800dc))
* **inspector:** surface video source and embed URL in the inspector ([0f33b2e](https://github.com/jaapstronks/deckyard/commit/0f33b2e36befa5e544673a5966f8fecd31fa3cdb))
* **install:** make the default file-storage install actually usable end-to-end ([#285](https://github.com/jaapstronks/deckyard/issues/285)) ([7a37b97](https://github.com/jaapstronks/deckyard/commit/7a37b97437ab619ab0d9cff3d853bf53c592183a))
* **layout-switcher:** set van cross-type tegels na conversie echt toepassen ([a718862](https://github.com/jaapstronks/deckyard/commit/a7188627299b9c9ab46b42c3398e60f82433ded5))
* **list:** stop the deck-card menu leaking a document click listener (F7) ([#322](https://github.com/jaapstronks/deckyard/issues/322)) ([d5e83da](https://github.com/jaapstronks/deckyard/commit/d5e83da8d688d4ca1e26e09268a87a837ddad24e))
* **llm:** stop sending temperature to OpenAI models that reject it ([#85](https://github.com/jaapstronks/deckyard/issues/85)) ([e712222](https://github.com/jaapstronks/deckyard/commit/e7122223aaf200110c8f6cbefcb76d066acf49db))
* **markdown:** stop infinite loop on unsupported heading lines (# / ###) ([2f6356c](https://github.com/jaapstronks/deckyard/commit/2f6356cf25453db9d67783e0ac77ba2e0d3791ba))
* **mcp:** pass acting owner to updatePresentation so author-locked slides stay editable for the author ([#30](https://github.com/jaapstronks/deckyard/issues/30)) ([91d714d](https://github.com/jaapstronks/deckyard/commit/91d714d9b5a6bd84478b05b8c28d2497339cb260))
* **mobile:** shorten the long-press compat-click guard to 350ms ([#158](https://github.com/jaapstronks/deckyard/issues/158)) ([3acdf6a](https://github.com/jaapstronks/deckyard/commit/3acdf6aba467f10a4dce8e07d9d5ef82e99bca19))
* **new-deck:** put the deck's own name on the opening title slide ([#112](https://github.com/jaapstronks/deckyard/issues/112)) ([0c94758](https://github.com/jaapstronks/deckyard/commit/0c947582fb2f9c878e7ce167a3eeeaf3f14bdeee))
* **notifications:** give the bell dropdown a real row design ([#111](https://github.com/jaapstronks/deckyard/issues/111)) ([6c0dafb](https://github.com/jaapstronks/deckyard/commit/6c0dafb8e4576c45f21684dde4fdd5ee18b8728d))
* **notifications:** guard fire-and-forget comment email against unhandled rejection ([#328](https://github.com/jaapstronks/deckyard/issues/328)) ([d0d5166](https://github.com/jaapstronks/deckyard/commit/d0d5166e4a66e167d0711d93584a606d10df63c4))
* **partner-split:** readable subheading, and no hardcoded demo photo ([#126](https://github.com/jaapstronks/deckyard/issues/126)) ([34a742a](https://github.com/jaapstronks/deckyard/commit/34a742a035ad92f9151264ad38656716a510800e))
* **pdf-export:** configurable timeout for server-rendered PDF ([#4](https://github.com/jaapstronks/deckyard/issues/4)) ([c389b9d](https://github.com/jaapstronks/deckyard/commit/c389b9db48f4b56f8c23002038a43b4dcd7dcee3))
* **picker:** make "Content columns" the explicit two-column choice ([#143](https://github.com/jaapstronks/deckyard/issues/143)) ([c116af8](https://github.com/jaapstronks/deckyard/commit/c116af821843b012e50bc9648ced1e9f0d871202))
* **picker:** polish add-slide schematics ([#140](https://github.com/jaapstronks/deckyard/issues/140)) ([12ada28](https://github.com/jaapstronks/deckyard/commit/12ada28a9941e3dae924efbb67f8245e38ae254c))
* **quote:** don't render an empty portrait circle - portraits are fully optional ([#28](https://github.com/jaapstronks/deckyard/issues/28)) ([e4844e2](https://github.com/jaapstronks/deckyard/commit/e4844e20cb8abc4a04202bdf1384131bf2cea25d))
* **rate-limit:** await allowRequest so the limiter trips under Redis ([#229](https://github.com/jaapstronks/deckyard/issues/229)) ([5cd280a](https://github.com/jaapstronks/deckyard/commit/5cd280a2fb27f7d44d5299bcad2d3c0f52fc4de8))
* **sandbox:** fill theme picker, drop library/AI, breathe under topbar ([#293](https://github.com/jaapstronks/deckyard/issues/293)) ([8ae9adc](https://github.com/jaapstronks/deckyard/commit/8ae9adc54bd54eb48901531ae10475699b8294b1))
* **sandbox:** keep the examples shelf on Home after the first deck ([83b857d](https://github.com/jaapstronks/deckyard/commit/83b857d2170e3ed567ec70b96154b08c78a2418d))
* **save:** stale-tab follow-ups - wake-up refresh, volgorde-behoud en merge-audit ([5a13125](https://github.com/jaapstronks/deckyard/commit/5a13125ff80785e448732a2d6c871b6ece24518f))
* **save:** staleness-cap + per-slide conflictdetectie op de slide-level merge ([8951677](https://github.com/jaapstronks/deckyard/commit/895167778bdd2c3ab750f366411a3d0161a00217))
* **save:** staleness-cap + per-slide conflictdetectie op de slide-level merge ([d9f1b64](https://github.com/jaapstronks/deckyard/commit/d9f1b645bd873fc0e209fedf0130c03afc863735))
* **security:** cap public SSE connections (MH3) + clear prod-tree advisories (M4) (cluster 5) ([#240](https://github.com/jaapstronks/deckyard/issues/240)) ([a465958](https://github.com/jaapstronks/deckyard/commit/a465958091134f2ece3eecdf3ddc49ee880ce481))
* **security:** cap publish/follow-codes body + CSRF-check sandbox cookie ([#123](https://github.com/jaapstronks/deckyard/issues/123)) ([043cab2](https://github.com/jaapstronks/deckyard/commit/043cab21109b90176c7b3af3b95a76db602ba761))
* **security:** close file-read + IDOR holes in export/api-keys/jobs (cluster 1) ([#231](https://github.com/jaapstronks/deckyard/issues/231)) ([1c0e088](https://github.com/jaapstronks/deckyard/commit/1c0e088f05c409052ce596f7c8bd2f96c01ea7d1))
* **security:** LOW-batch hardening — SSRF, CSS filter, error/log leaks (cluster 7, L2/L4/L5/L6/L7/L8) ([#248](https://github.com/jaapstronks/deckyard/issues/248)) ([2655cab](https://github.com/jaapstronks/deckyard/commit/2655cab2509ee9afbe5f9d16ac230334237f2a35))
* **security:** per-resource authz on present-sessions + csv-url SSRF + share-link IDOR (cluster 4, H4/MH1/MH2) ([#235](https://github.com/jaapstronks/deckyard/issues/235)) ([70807ed](https://github.com/jaapstronks/deckyard/commit/70807ed9002af258f3a5c592099cf47afbb34e8d))
* **security:** stop stack-trace leaks + add framing/security headers (cluster 3) ([#233](https://github.com/jaapstronks/deckyard/issues/233)) ([ddbd1a3](https://github.com/jaapstronks/deckyard/commit/ddbd1a345cd78706786020ccd51842c088905efb))
* **security:** trust rightmost XFF hop + CSPRNG follow codes (cluster 6, M2/M3) ([#246](https://github.com/jaapstronks/deckyard/issues/246)) ([ce87a8f](https://github.com/jaapstronks/deckyard/commit/ce87a8f73f3c03bde2bdaad940a0937ec665d060))
* **security:** versioned scrypt cost + AUTH_SECRET boot floor (cluster 8, L1/L3) ([#250](https://github.com/jaapstronks/deckyard/issues/250)) ([285c9c5](https://github.com/jaapstronks/deckyard/commit/285c9c5db7fd7664e511126fb756d8d9bc705836))
* **server:** guard fire-and-forget email/notify tasks against unhandled rejection (F8) ([#321](https://github.com/jaapstronks/deckyard/issues/321)) ([75ea614](https://github.com/jaapstronks/deckyard/commit/75ea614cda8ebc9e899b0bc7966ab6945d7eefb1))
* **settings:** hide Fonts/Slide Types panels when leaving their tab ([#150](https://github.com/jaapstronks/deckyard/issues/150)) ([a87e370](https://github.com/jaapstronks/deckyard/commit/a87e370d568d5cae8af9b4232d60a1a11ba3d754))
* **share:** guard presenter-control link, inline created link, drop dead edit perm ([#110](https://github.com/jaapstronks/deckyard/issues/110)) ([1ef7104](https://github.com/jaapstronks/deckyard/commit/1ef7104eec92597fdf247f0c16053ffc43b7ce0c))
* **share:** persist isViewOnly on Postgres so workspace pills survive reload ([#165](https://github.com/jaapstronks/deckyard/issues/165)) ([8da7b6a](https://github.com/jaapstronks/deckyard/commit/8da7b6a08e1c761e54066cddf32f099da74b8725))
* **slide-library:** persist i18n per-language content on both backends ([#107](https://github.com/jaapstronks/deckyard/issues/107)) ([7466e94](https://github.com/jaapstronks/deckyard/commit/7466e94922981d2405d9585cbae1b857d69e7877))
* **slides:** background-aware link colour token for slide-body links ([#222](https://github.com/jaapstronks/deckyard/issues/222)) ([4fd1ae9](https://github.com/jaapstronks/deckyard/commit/4fd1ae9d557e15d78c2ffb8e88acbdfe4a6905f1))
* **slides:** use shadow tokens so print drops elevation (no grey blocks) ([#230](https://github.com/jaapstronks/deckyard/issues/230)) ([636f5e7](https://github.com/jaapstronks/deckyard/commit/636f5e7082969172e64f4adceb3d52eb3fdf56fa))
* **storage:** route version history through the storage adapter + import migration ([#237](https://github.com/jaapstronks/deckyard/issues/237)) ([df7c5c8](https://github.com/jaapstronks/deckyard/commit/df7c5c8a9ff6c905eb270e3906c37b19a79770f0))
* **theme-editor:** keep Save reachable, and stop shadowing it ([#139](https://github.com/jaapstronks/deckyard/issues/139)) ([d52fe2a](https://github.com/jaapstronks/deckyard/commit/d52fe2ad43b625f447cb86d71304b84e741cb026))
* **theme:** let /change-theme switch the theme via a gated escape hatch ([#236](https://github.com/jaapstronks/deckyard/issues/236)) ([5f03a8e](https://github.com/jaapstronks/deckyard/commit/5f03a8eb9bdba18ac7a38f19c4be7fb82c60d863))
* **theme:** load database themes in the client, and invalidate on save ([#132](https://github.com/jaapstronks/deckyard/issues/132)) ([845445f](https://github.com/jaapstronks/deckyard/commit/845445f62278d682576afe1144caa72abd28004c))
* **theme:** one shared normalizeTheme, and emit the legacy alias tokens ([#116](https://github.com/jaapstronks/deckyard/issues/116)) ([c5b6c99](https://github.com/jaapstronks/deckyard/commit/c5b6c9959bafef7e3e07b4d1d64ace3dd9fbcb75))
* **theme:** pin accent-contrast token in the config back-compat fixture ([#122](https://github.com/jaapstronks/deckyard/issues/122)) ([43a12f4](https://github.com/jaapstronks/deckyard/commit/43a12f4f511ee06a854956976de41b2f18546dce))
* **theme:** readable quote author/byline on deckyard's dark quote slide ([#16](https://github.com/jaapstronks/deckyard/issues/16)) ([8ee2f7c](https://github.com/jaapstronks/deckyard/commit/8ee2f7cc768593cfc7ea4865721d14ad2ecbb362))
* **timeline:** keep cards readable on every background ([92bc5c1](https://github.com/jaapstronks/deckyard/commit/92bc5c1ff50d01d063c676f257ec289d8d6c136e))
* **timeline:** keep cards readable on every background ([a6dd602](https://github.com/jaapstronks/deckyard/commit/a6dd602d494aa2602427c64944d881976b708946))
* **title-slide:** apply muted caption colour on dark-text canonical backgrounds ([43f8aa6](https://github.com/jaapstronks/deckyard/commit/43f8aa626e79e9a3c83e641a664e023374a766c6))
* **validate:** accept the '' cleared-value convention for optional enum fields ([e0ffd1f](https://github.com/jaapstronks/deckyard/commit/e0ffd1fed5895c21d6495329802087654b1f65a6))


### Security

* **auth:** brute-force throttle on password login ([918d5c2](https://github.com/jaapstronks/deckyard/commit/918d5c228a769e9fd2a519d4e08e42165b391f6a))
* **auth:** gate AUTH_DEV_BYPASS on NODE_ENV=development ([1471e1b](https://github.com/jaapstronks/deckyard/commit/1471e1be259a2e7bdc93ba64bdf8b03027fb50ea))
* **auth:** hard-fail instead of failing open to anonymous admin ([9fc371d](https://github.com/jaapstronks/deckyard/commit/9fc371d6ed9342e3e822e7248d1ffbf941275653))
* **container:** run as non-root, gate Chromium sandbox behind env ([7b8ef4a](https://github.com/jaapstronks/deckyard/commit/7b8ef4a612b494d7988876dbc7fff4ff9cd64eea))
* **csrf:** origin-check on cookie-authed state-changing requests ([18e5710](https://github.com/jaapstronks/deckyard/commit/18e5710ffbd74f1cae6b48b62d2717ea73319460))
* **export:** SSRF guard for remote images in render/export ([1f91de2](https://github.com/jaapstronks/deckyard/commit/1f91de218abe8b7a0e27a7e75e4a8ff716e9a835))
* **http:** cap request-body size to prevent memory DoS ([898606e](https://github.com/jaapstronks/deckyard/commit/898606e363915fb5869e5078762674940ecc4157))
* **media:** confine LocalProvider keys to uploadsDir ([6953fb2](https://github.com/jaapstronks/deckyard/commit/6953fb21e92fcac06a6e36aee0b3413fa9055bbb))
* **ssrf:** block IPv4-mapped/compatible IPv6 in hex-group form ([91b22b2](https://github.com/jaapstronks/deckyard/commit/91b22b2c31e88c27c9b2fa526639f0297ddf4246))
* **uploads:** serve user-uploaded SVG inert (stored-XSS fix) ([a7b09f2](https://github.com/jaapstronks/deckyard/commit/a7b09f27b0b462374320d02995a5b588b87acb63))


### Changed

* **export:** embed images in parallel with a per-run dedupe cache ([#223](https://github.com/jaapstronks/deckyard/issues/223)) ([3bca65a](https://github.com/jaapstronks/deckyard/commit/3bca65a662fe7d9569c55b896f9bd22dea683040))
* **list:** downscale ImageKit thumbnail images to card size (Fase A, rest) ([#289](https://github.com/jaapstronks/deckyard/issues/289)) ([b1463c2](https://github.com/jaapstronks/deckyard/commit/b1463c2c1c48935031316541e086b5c006debf3d))
* **list:** front-page-perf follow-ups — slim payload, themed placeholder, warm-on-publish ([58fa1f9](https://github.com/jaapstronks/deckyard/commit/58fa1f96c69d2f285fd786f12d9f61b9da9246f0))
* **list:** front-page-perf follow-ups — slim payload, themed placeholder, warm-on-publish ([5ca30f3](https://github.com/jaapstronks/deckyard/commit/5ca30f339dec18085000a8cb08ef33bb39573c74))
* **list:** lazy-render deck thumbnails with skeletons (front-page phase 1) ([#287](https://github.com/jaapstronks/deckyard/issues/287)) ([34da75d](https://github.com/jaapstronks/deckyard/commit/34da75d3734a37672b38a81ce5d12bd78b3a9173))
* **list:** serve resized variants for local-upload thumbnails (Fase A deel 3) ([39777a1](https://github.com/jaapstronks/deckyard/commit/39777a19d9fb190681ae8cabfb5520f81fbed059))
* **list:** serve resized variants for local-upload thumbnails (Fase A deel 3) ([#292](https://github.com/jaapstronks/deckyard/issues/292)) ([5b5f2f9](https://github.com/jaapstronks/deckyard/commit/5b5f2f90015c377f1fd9f4976b93c09abde26de5))
* **list:** server-rasterized PNG thumbnails for the deck grid (Fase B) ([29ae4e2](https://github.com/jaapstronks/deckyard/commit/29ae4e2a501932fa7abf65cd476ecf0119307747))
* **list:** server-rasterized PNG thumbnails for the deck grid (Fase B) ([2c72007](https://github.com/jaapstronks/deckyard/commit/2c7200754251b810031181e3f4f4c0113a743f0e))

## [1.0.0] — 2026-07-14

### Added

- First public open-source release 🎉
- 38 typed slide types with a shared schema → render → editor pipeline
- AI deck generation, iteration, analysis and validation (BYO LLM: OpenAI,
  Claude, Mistral, DeepSeek, or any OpenAI-compatible endpoint)
- MCP server (22 tools, 6 guided prompts) over stdio and SSE
- Live presenting: speaker console, two-window presenter, audience
  follow-along with polls, Q&A and feedback
- Theming system with custom themes, custom slide types and fork-friendly
  `custom/` directories
- Exports: PDF, PPTX, standalone HTML, PNG; embed SDK
- i18n groundwork for 12 locales (en/nl fully populated)
