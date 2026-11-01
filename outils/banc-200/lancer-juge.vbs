' Juge Rat-Market : lance outils\banc-200\lancer-juge.js par node.exe CACHE (aucune fenetre de console). Cible du raccourci du Bureau (creer-raccourci.ps1).
' Le dossier de travail est la racine de la copie qui contient ce fichier (outils\banc-200\..\..). Aucun secret ici : le lanceur lit lui-meme le .env.
Option Explicit
Dim sh, fso, dossier, racine, node, q, rc, journal, detail
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
q = Chr(34)
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
racine = fso.GetParentFolderName(fso.GetParentFolderName(dossier))
sh.CurrentDirectory = racine
node = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"
rc = sh.Run(q & node & q & " " & q & dossier & "\lancer-juge.js" & q, 0, True)
If rc <> 0 Then
    journal = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\rat-market-juge\juge.log"
    If fso.FileExists(journal) Then
        detail = "Details : " & journal
    Else
        detail = "Aucun journal n'a pu etre ecrit : le programme s'est arrete avant de demarrer (verifiez que Node est installe et que la copie d'api-v2 est a jour)."
    End If
    MsgBox "Le juge Rat-Market n'a pas pu demarrer (code " & rc & ")." & vbCrLf & detail & vbCrLf & "Si le port 4747 est pris par un autre programme, fermez-le puis relancez.", 48, "Juge Rat-Market"
End If
