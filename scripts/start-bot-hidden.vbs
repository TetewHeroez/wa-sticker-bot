Option Explicit

Dim shell, appDir, nodePath, appPath, command

Set shell = CreateObject("WScript.Shell")
appDir = "D:\Tetew Heroez\wa-sticker-bot"
nodePath = "C:\Program Files\nodejs\node.exe"
appPath = appDir & "\index.js"

shell.CurrentDirectory = appDir

Do
  command = """" & nodePath & """ """ & appPath & """"
  shell.Run command, 0, True
  WScript.Sleep 5000
Loop
