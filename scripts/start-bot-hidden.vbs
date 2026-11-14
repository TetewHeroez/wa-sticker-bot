Option Explicit

Dim shell, appDir, nodePath, appPath, command

Set shell = CreateObject("WScript.Shell")
appDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
appDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(appDir)
nodePath = "node.exe"
appPath = appDir & "\index.js"

shell.CurrentDirectory = appDir

Do
  command = """" & nodePath & """ """ & appPath & """"
  shell.Run command, 0, True
  WScript.Sleep 5000
Loop
