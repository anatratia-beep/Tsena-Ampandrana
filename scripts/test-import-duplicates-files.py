# Fichiers Excel pour scripts/test-import-duplicates.mjs : python3 scripts/test-import-duplicates-files.py /tmp/claude-0/dup
import openpyxl, sys
import os
d=sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/dup"; os.makedirs(d, exist_ok=True)
def w(name, rows):
    wb=openpyxl.Workbook(); ws=wb.active; ws.title='Stock'
    for r in rows: ws.append(r)
    wb.save(f'{d}/{name}.xlsx')
H=['Catégorie','Modèle','Taille','Stock','PV détail','Prix de revient']
base=[H,['Pyjamas homme','PH6','L',10,48000,30000],['Pyjamas homme','PH6','XL',5,48000,30000],['Pyjamas homme','PH7','L',3,50000,31000]]
w('stock',base)
m=[list(r) for r in base]; m[2][3]=8; w('stock_modif',m)
w('stock_autrepage',[H]+[['Boxer homme']+r[1:] for r in base[1:]])
w('stock_ambigu',[H,['Boxer','BX1','L',4,12000,6000]])
w('simple',[['Catégorie','Code article',"Nom de l'article",'Couleur','Taille','Stock','PV détail (Ar)'],['Boxer garçon','PH6','Pyjama PH6','','L',10,48000],['Boxer garçon','KD9','Boxer KD9','','M',6,9000]])
w('commande',[['REFERENCE','NUMERO DE COMMANDE','NOM','QTE COMMANDEE','PU (RMB)','PV DET'],['ZZ1','111','L',10,20,40000]])
