; KJ Trace Team — custom NSIS installer hooks
;
; Tauri 2 の installer.nsi に挿入されるフック．デスクトップとスタートメニュー
; のショートカット作成可否をユーザに確認する．
;
; - PREINSTALL : MessageBox 2 回．それぞれ YES/NO を変数に保存．
; - POSTINSTALL: Desktop=YES なら .lnk 作成．StartMenu=NO なら Tauri が既定で
;                作った Start Menu ショートカットを削除．
; - PREUNINSTALL: Desktop ショートカットを削除．

Var IncludeDesktop
Var IncludeStartMenu

!macro NSIS_HOOK_PREINSTALL
  ; 既定値は両方 YES (Silent install 時のデフォルト動作と一致)
  StrCpy $IncludeDesktop "1"
  StrCpy $IncludeStartMenu "1"

  ; インタラクティブインストール時のみ確認．Silent (/S) では YES が維持される．
  IfSilent skip_questions

    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 \
      "デスクトップにショートカットを作成しますか？$\r$\n(Create a Desktop shortcut?)" \
      /SD IDYES IDYES desktop_yes
      StrCpy $IncludeDesktop "0"
    desktop_yes:

    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 \
      "スタートメニュー (すべてのアプリ) に登録しますか？$\r$\n(Add to Start Menu / All Apps?)" \
      /SD IDYES IDYES startmenu_yes
      StrCpy $IncludeStartMenu "0"
    startmenu_yes:

  skip_questions:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Desktop shortcut: YES なら作成
  StrCmp $IncludeDesktop "1" 0 skip_desktop_create
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  skip_desktop_create:

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
