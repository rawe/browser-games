export function render(ctx, canvas, state) {
  const cell = canvas.width / state.cols;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#e74c3c';
  drawCell(ctx, state.food, cell);

  state.snake.forEach((segment, i) => {
    ctx.fillStyle = i === 0 ? '#2ecc71' : '#27ae60';
    drawCell(ctx, segment, cell);
  });

  if (state.gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Game Over', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '16px system-ui';
    ctx.fillText('Leertaste für Neustart', canvas.width / 2, canvas.height / 2 + 20);
  }
}

function drawCell(ctx, { x, y }, cell) {
  ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
}
