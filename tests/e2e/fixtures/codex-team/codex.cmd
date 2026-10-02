@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe" "%~dp0\codex.cjs" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node "%~dp0\codex.cjs" %*
)
