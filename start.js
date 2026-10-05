const { spawn } = require('child_process');

function run(file) {
  const p = spawn('node', [file], { stdio: 'inherit' });
  p.on('exit', (code) => {
    console.log(`${file} to'xtadi (kod ${code}), 5 soniyadan keyin qayta ishga tushadi`);
    setTimeout(() => run(file), 5000);
  });
}

run('discord-bot.js');   // Discord faylingiz nomi
run('bot.js');  // Telegram faylingiz nomi