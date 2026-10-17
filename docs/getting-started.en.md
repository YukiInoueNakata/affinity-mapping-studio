# Getting started (from installation to your first affinity diagram)

This guide walks a first-time user through installing Affinity Mapping Studio (AMS), turning text into cards, grouping them into an affinity diagram, and saving it.
Follow the screenshots and click the places outlined in red, one after another.

The app's interface is in Japanese only, so the screenshots show Japanese labels. Each step gives the English meaning of the label to click.

日本語版: [getting-started.ja.md](getting-started.ja.md)

- [1. Which file to download](#1-which-file-to-download)
- [2. Windows (.exe)](#2-windows-exe)
- [3. Windows (.msi)](#3-windows-msi)
- [4. Mac (.dmg)](#4-mac-dmg)
- [5. Try it out](#5-try-it-out)
- [6. Collaborative editing (connecting to a server)](#6-collaborative-editing-connecting-to-a-server)
- [7. Troubleshooting](#7-troubleshooting)

## 1. Which file to download

Download from the [Releases](https://github.com/YukiInoueNakata/affinity-mapping-studio/releases) page.
Open the top release (marked "Latest") and pick one file for your computer from the "Assets" list.

![The Releases page (the Latest release)](images/getting-started/win-01-releases.png)

| Computer | Recommended | Example file name |
|---|---|---|
| Windows | `.exe` (no administrator rights needed) | `Affinity.Mapping.Studio_0.2.30_x64-setup.exe` |
| Windows (at work or university, when a standard uninstall is preferred) | `.msi` | `Affinity.Mapping.Studio_0.2.30_x64_en-US.msi` |
| Mac (same file for Intel and Apple silicon) | `.dmg` | `Affinity.Mapping.Studio_0.2.30_universal.dmg` |

`0.2.30` in the file name is the version number. It changes in newer releases.

![Click the .exe in the Assets list](images/getting-started/win-02-assets.png)

## 2. Windows (.exe)

### Install

1. On the Releases page, click `…_x64-setup.exe` to download it.

2. Double-click the downloaded file.

   ![The downloaded .exe](images/getting-started/win-04-open-installer.png)

3. If "Windows protected your PC" appears, click "More info" (詳細情報).
   This screen appears because the app is not digitally signed.

   ![Click "More info"](images/getting-started/win-05-smartscreen.png)

4. Click "Run anyway" (実行).

   ![Click "Run anyway"](images/getting-started/win-06-smartscreen-run.png)

5. On the welcome screen, click "Next" (次へ).

   ![Welcome (Next)](images/getting-started/win-07a-setup.png)

6. Keep the install location as it is and click "Next" (次へ).

   ![Install location (Next)](images/getting-started/win-07b-setup.png)

7. The installer asks two questions. Usually answer "Yes" (はい) to both.
   - "Create a Desktop shortcut?"
   - "Add to Start Menu / All Apps?"

   ![Desktop shortcut](images/getting-started/win-08a-desktop-shortcut.png)

   ![Add to the Start menu](images/getting-started/win-08b-start-menu-reg.png)

8. When "Installation Complete" (インストールの完了) appears, click "Next" (次へ).

   ![Installation complete (Next)](images/getting-started/win-09-setup-complete.png)

9. Click "Finish" (完了). If "Run Affinity Mapping Studio" is checked, the app starts right away.

   ![Finish](images/getting-started/win-09b-setup-finish.png)

### Start

Open the Start menu, type "Affinity", and click "Affinity Mapping Studio".
You can also double-click the desktop shortcut.

![Type Affinity in the Start menu](images/getting-started/win-10-start-menu.png)

### Uninstall

1. Open Settings → Apps → Installed apps, click "…" next to "Affinity Mapping Studio", and click "Uninstall".
2. In the uninstaller, click "Uninstall" (アンインストール).
   If you check "Delete the application data" (アプリケーションデータを削除する), the data the app keeps on your computer (settings, and local copies kept for collaborative editing) is also deleted.
   Project files you saved yourself (`.kjproj`) are not deleted. If you plan to reinstall, leave the box unchecked.

   ![Click "Uninstall"](images/getting-started/win-11-uninstall.png)

## 3. Windows (.msi)

### Install

1. On the Releases page, click `…_x64_en-US.msi` to download it.
2. Double-click the downloaded file. If "Windows protected your PC" appears, click "More info" and then "Run anyway", as with the `.exe`.
3. Follow the installer and click "Next". If you are asked for administrator permission, click "Yes".

### Uninstall

Open Settings → Apps → Installed apps, click "…" next to "Affinity Mapping Studio", and click "Uninstall".

## 4. Mac (.dmg)

<!-- TODO: Mac screenshots will be added later -->

### Install

1. On the Releases page, click `…_universal.dmg` to download it, then double-click the downloaded file.
2. In the window that opens, drag the "Affinity Mapping Studio.app" icon onto the "Applications" folder and release it.
3. Open the "Applications" folder in Finder, **right-click** "Affinity Mapping Studio" (on a trackpad, click with two fingers or hold the control key while clicking), and choose "Open".
   The app is not digitally signed, so it does not open with a double-click the first time.
4. When "Are you sure you want to open it?" appears, click "Open". From then on, a normal double-click starts the app.

On macOS 13 or later, if steps 3 and 4 do not work, open System Settings → Privacy & Security and click "Open Anyway" near the bottom.

> **If you see "is damaged and can't be opened"**
> Open Terminal (Applications → Utilities), paste the line below, press Enter, and open the app again.
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/Affinity Mapping Studio.app"
> ```

### Uninstall

Move "Affinity Mapping Studio" from the "Applications" folder to the Trash.

## 5. Try it out

Here you import 15 short free-text answers, turn them into cards, group similar cards together, and save the affinity diagram.
Save the 15 lines below as a text file (for example `cards.txt`) and use it for practice. The lines are in Japanese so that they match the screenshots.

<details>
<summary>Practice text (cards.txt)</summary>

```text
朝の授業に間に合うように起きるのがつらい
レポートの締切が重なると徹夜になる
図書館の席がすぐ埋まってしまう
サークルの先輩に相談できて安心した
アルバイトのシフトと授業が重なる
友だちと一緒に勉強すると続けやすい
通学の電車が混んでいて疲れる
奨学金の手続きが分かりにくい
ゼミの発表で緊張して話せなかった
学食のメニューが少ない
オンライン授業は自分のペースで進められる
将来の仕事についてまだ決められない
一人暮らしで食事が偏りがち
先生に質問しやすい雰囲気だと助かる
休日に何もしないで終わってしまう
```

</details>

### Create a new project

1. When the app starts, this screen appears. Click "New project" (新規プロジェクト).

   ![The start screen](images/getting-started/app-01-start.png)

2. Type a name for the project.

   ![The project name box](images/getting-started/app-02-newproject-dialog.png)

3. Click "Create" (作成).

   ![Click "Create"](images/getting-started/app-03-newproject-create.png)

### Parts of the screen

After you create a project, the screen looks like this. The numbers match the table below.

![Parts of the screen](images/getting-started/app-04-overview.png)

| No. | Name | What it is for |
|---|---|---|
| 1 | Toolbar | New / Open / Save, importing text, zoom, exporting to an image or Word |
| 2 | View switch | "Canvas" (キャンバス, where you build the diagram), "Source viewer" (原文ビューア, the imported text), "Final diagram" (最終図解) |
| 3 | Left panel | Search, participants, lists of groups and cards |
| 4 | Hierarchy | The nesting of groups as a list |
| 5 | Card actions | Group, merge, and other actions on the selected cards |
| 6 | Canvas | Where you lay out cards to build the affinity diagram |
| 7 | Unsorted / On hold | Cards not yet placed on the canvas |
| 8 | Details | View and edit the selected card or group |

If the canvas is too narrow (for example on a laptop), you can fold the left panel (3), Unsorted / On hold (7), and Details (8) with the ◀ / ▶ button on each panel. A folded panel stays as a thin tab at the edge of the screen (such as "▶ 検索" or "◀ 詳細"); click it to open the panel again.

### Import the text

1. Click "Import text" (テキスト取り込み) in the toolbar.

   ![Click "Import text"](images/getting-started/app-05-import-button.png)

2. The import wizard opens. It has five steps. First click "Choose file..." (ファイルを選択...) and pick the `cards.txt` you prepared.
   Besides plain text, you can import Markdown, Word (.docx), Excel (.xlsx), and CSV.

   ![Click "Choose file..."](images/getting-started/app-06-wizard-1-file.png)

3. The beginning of the file is shown. Click "Next" (次へ).

   ![File preview (Next)](images/getting-started/app-07-wizard-preview.png)

4. In "2. How to split" (区切り方法), keep the first option, "split by line (1 line = 1 segment)", and click "Next".
   Each line becomes one unit of text (a segment).

   ![How to split (Next)](images/getting-started/app-08-wizard-step2.png)

5. In "3. Column mapping" (列マッピング), change "Header row" (ヘッダ一行) at the top left to "**None**" (なし).
   If you leave it as it is, the first line is treated as a heading and is not imported. Then click "Next".

   ![Set the header row to "None" (Next)](images/getting-started/app-09-wizard-step3.png)

6. In "4. Pattern" (パターン判定), keep "Interview" (インタビュー型) and click "Next". The participant code (`P01`) is filled in automatically.

   ![Pattern (Next)](images/getting-started/app-10-wizard-step4.png)

7. In "5. Confirm and import" (確認・取り込み), check that 15 lines will be imported (取り込み対象行 15 行) and click "Import" (取り込む).

   ![Click "Import"](images/getting-started/app-11-wizard-step5.png)

8. The imported lines appear one by one in the "Source viewer" (原文ビューア). They are not cards yet (each is marked 未カード化, "not yet a card").

   ![Imported lines in the source viewer](images/getting-started/app-12-genbun.png)

### Turn the text into cards

In affinity mapping, you cut the text into meaningful pieces and put each piece on its own card.

1. In the source viewer, select the lines you want to turn into cards. Here we select six.
   Click the first line, then click the others **while holding the Ctrl key**. Each line is selected in full.
   Two buttons appear at the top: "Make a card" (カード化) and "Make one card per segment" (セグメントごとにカード化). Click "Make one card per segment (6 cards)".

   ![Click "Make one card per segment"](images/getting-started/app-13-select-cardify.png)

   - "Make one card per segment" turns each selected line into its own card. "Make a card" turns the whole selection into one card.
   - To make a card from part of a line, select the text by dragging. The card starts where your drag starts, so to include the beginning of a line, start dragging from its left edge.

2. Go back to the "Canvas" (キャンバス). The new cards are in "Unsorted" (未分類) on the right.

   ![Cards in "Unsorted"](images/getting-started/app-14-unclassified.png)

3. Click "To canvas" (キャンバスへ) on a card to place it on the canvas. You can also drag the card onto the canvas.
   Place all six cards.

   ![Click "To canvas"](images/getting-started/app-15-to-canvas.png)

4. Drag the cards on the canvas to move them. Bring cards that seem similar close together.

   ![Six cards on the canvas](images/getting-started/app-16-cards-on-canvas.png)

> To add something that is not in the source text, click "+ New card" (+ 新規カード) in the source viewer, type the text, and click "Create" (作成).
> The new card goes to "Unsorted", so place it with "To canvas" in the same way.
>
> ![The "+ New card" button](images/getting-started/app-90-newcard-button.png)
>
> ![Type the text and click "Create"](images/getting-started/app-91-newcard-dialog.png)

### Group similar cards

1. Select the cards you want to group. Click the first card, then click the others **while holding the Shift key**.
   Click "Group (3 cards)" (グループ化) at the top.

   ![Click "Group"](images/getting-started/app-17-select-group.png)

2. The three cards are put inside one group frame. At first the group has a temporary name such as "グループレベル1 1".

   ![The new group](images/getting-started/app-18-grouped.png)

3. Click the group frame. A "Label" (表札) box appears under "Group details" (グループ詳細) on the right.
   Write in a few words what the group is about (here, 勉強と学習環境の悩み, "worries about study and the study environment") and press Enter.

   ![Enter a label](images/getting-started/app-19-label-input.png)

4. In the same way, put the other three cards into a group labelled 人とのつながり・支え ("connections and support").
   Click "Fit view" (the square button at the lower left of the canvas) to fit the whole diagram on the screen.

   ![An affinity diagram with two groups](images/getting-started/app-20-two-groups.png)

### Save

1. Click "Save" (保存) in the toolbar.

   ![Click "Save"](images/getting-started/app-21-save-button.png)

2. Choose where to save (here, the `AMS-guide` folder inside Documents) and a file name, and click "Save".
   This creates a `.kjproj` file. Next time, open it with "Open" (開く) in the toolbar.

   ![The save dialog](images/getting-started/app-22-save-dialog.png)

### Export to an image or Word

1. "Export figure" (図を出力) in the toolbar saves the diagram as PNG, PDF, or SVG.
   "Word export" (Word 出力) opens a wizard that asks a few questions and builds a draft of a paper or report in Word, with paragraphs for the method, the results (the group hierarchy, labels, and cards), and the discussion.

   ![The "Export figure" and "Word export" buttons](images/getting-started/app-23-export-buttons.png)

2. In "Export figure", choose a format and click "Generate preview" (プレビュー生成).

   ![Choose a format and click "Generate preview"](images/getting-started/app-24-export-dialog.png)

3. Check the result, click "Save as PNG" (PNG で保存), and choose where to save it.

   ![Click "Save as PNG"](images/getting-started/app-25-export-preview.png)

## 6. Collaborative editing (connecting to a server)

To join a collaborative editing server, you receive an "invite URL" from the administrator. Do not show or paste the invite URL anywhere else.

1. On the start screen, click "Connect to a server and join an existing room…" (サーバーに接続して既存ルームに参加…; see the first screen in [5. Try it out](#5-try-it-out)).
   While a project is open, clicking the "Offline" (オフライン) badge at the top opens the same dialog.

2. Paste the invite URL into the "Paste invite URL" (招待 URL を貼付) box. The server URL, room name, and invite token are filled in automatically.
   In "Display name" (表示名), enter the name other participants will see.

3. Click "Connect" (接続).

   ![Paste the invite URL and click "Connect" (the URL in the picture is a placeholder)](images/getting-started/collab-01-dialog.png)

Once connected, the "Offline" badge changes and other participants' edits appear on your screen as they happen.

## 7. Troubleshooting

- If something does not work, open an [issue](https://github.com/YukiInoueNakata/affinity-mapping-studio/issues) and tell us your computer (Windows or Mac, and its version) and what happened.
