TERMUX'DA ISHGA TUSHIRISH
1) F-Droid'dan Termux o'rnating (Play Store'dagisi eskirgan).
2) Termux'da:  pkg update -y && pkg install -y nodejs tmux
3) Shu papkani telefonga o'tkazing, Termux'da:  termux-setup-storage
   keyin: cp -r ~/storage/downloads/nuqtamc-bot ~/ && cd ~/nuqtamc-bot
4) cp .env.example .env && nano .env   (token, API key, server id, admin id ni yozing)
5) npm install
6) tmux new -s bot   keyin:   ./start.sh      (chiqish: Ctrl+B, keyin D)
7) Android sozlamalari: Termux uchun "Battery -> Unrestricted" qiling.
MUHIM: Render'dagi servisni Suspend qiling va laptopdagi botni o'chiring (409 Conflict bo'lmasligi uchun).
