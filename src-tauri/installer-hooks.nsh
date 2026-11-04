; KJ Trace Team — custom NSIS installer hooks
;
; Tauri 2 の installer.nsi に挿入されるフック．スタートメニューへの登録可否を
; ユーザに確認する．
;
; デスクトップのショートカットは Tauri の完了画面のチェック
; （「デスクトップショートカットを作成する」）に任せる．以前はここでも
; MessageBox で聞いていたため同じ質問が 2 回出て，MessageBox で「いいえ」と
; 答えても完了画面のチェックが付いたままだと作られていた．
;
; - PREINSTALL : MessageBox 1 回．YES/NO を変数に保存．
; - POSTINSTALL: StartMenu=NO なら Tauri が既定で作った Start Menu
;                ショートカットを削除．
; - PREUNINSTALL: Desktop ショートカットを削除（旧版のフックが作った分も含む）．

Var IncludeStartMenu

!macro NSIS_HOOK_PREINSTALL
  ; 既定値は YES (Silent install 時のデフォルト動作と一致)
  StrCpy $IncludeStartMenu "1"

  ; インタラクティブインストール時のみ確認．Silent (/S) では YES が維持される．
  ; 自動更新は passive (/P) と /UPDATE で走る．そこで聞くと無人の更新が止まり，
  ; 「いいえ」でショートカットが消えるので聞かない．$PassiveMode・$UpdateMode は
  ; Tauri の installer.nsi が .onInit で設定する．更新では Tauri がスタートメニューの
  ; ショートカットを作り直さない（今ある状態がそのまま残る）ので，YES のままでよい．
  IfSilent skip_questions
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    Goto skip_questions
  ${EndIf}

    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 \
      "スタートメニュー (すべてのアプリ) に登録しますか？$\r$\n(Add to Start Menu / All Apps?)" \
      /SD IDYES IDYES startmenu_yes
      StrCpy $IncludeStartMenu "0"
    startmenu_yes:

  skip_questions:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Start Menu shortcut: Tauri が既定で作成．NO なら削除．
  ; 既定 (no folder) は $SMPROGRAMS\${PRODUCTNAME}.lnk
  ; startMenuFolder 指定がある場合は $SMPROGRAMS\<folder>\${PRODUCTNAME}.lnk
  StrCmp $IncludeStartMenu "0" 0 skip_startmenu_delete
    Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
    RMDir "$SMPROGRAMS\${PRODUCTNAME}"
  skip_startmenu_delete:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Desktop ショートカットを削除 (存在しなければ何もしない)
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
