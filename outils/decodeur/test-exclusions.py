import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exclusions as X
ex = X.charger()
print("comptes :", json.dumps(ex["comptes"]))
print("témoin négatif :", X.temoin_negatif(ex), "(une empreinte du juge plantée fait lever ; un fichier propre passe)")
