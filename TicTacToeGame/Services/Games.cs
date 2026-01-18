using System.Collections.Concurrent;
using TicTacToeGame.Models;

namespace TicTacToeGame.Services;

public sealed class Games : IGames
{
    private readonly ConcurrentDictionary<string, Game> _gamesById = new(StringComparer.Ordinal);
    private readonly object _lock = new();

    public Result<Game> CreateGame(string hostPlayer, string friendlyName)
    {
        if (string.IsNullOrWhiteSpace(hostPlayer))
            return "Host player is required.";

        friendlyName = (friendlyName ?? string.Empty).Trim();
        if (friendlyName.Length == 0)
            return "Friendly name is required.";
        if (friendlyName.Length > 50)
            friendlyName = friendlyName[..50];

        var gameId = Guid.NewGuid().ToString("N");

        var game = new Game(
            GameId: gameId,
            FriendlyName: friendlyName,
            HostPlayer: hostPlayer,
            GuestPlayer: null,
            State: new GameState(
                Board: new Cell[9],
                NextTurnPlayer: hostPlayer,
                Status: GameStatus.WaitingForOpponent,
                WinnerPlayer: null));

        _gamesById[gameId] = game;
        return game;
    }

    public Result<Game> JoinGame(string gameId, string guestPlayer)
    {
        if (string.IsNullOrWhiteSpace(gameId))
            return "Game id is required.";

        if (string.IsNullOrWhiteSpace(guestPlayer))
            return "Guest player is required.";

        lock (_lock)
        {
            if (!_gamesById.TryGetValue(gameId, out var game))
                return "Game not found.";

            if (game.GuestPlayer is not null)
                return "Game already has two players.";

            if (game.HostPlayer == guestPlayer)
                return "Cannot join your own game.";

            var updated = game with
            {
                GuestPlayer = guestPlayer,
                State = game.State with { Status = GameStatus.InProgress }
            };

            _gamesById[gameId] = updated;
            return updated;
        }
    }

    public Result<Game> GetGame(string gameId)
    {
        if (string.IsNullOrWhiteSpace(gameId))
            return "Game id is required.";

        if (!_gamesById.TryGetValue(gameId, out var game))
            return "Game not found.";

        return game;
    }

    public Result<Game> MakeMove(string gameId, string player, int cellIndex)
    {
        if (string.IsNullOrWhiteSpace(gameId))
            return "Game id is required.";

        if (string.IsNullOrWhiteSpace(player))
            return "Player is required.";

        if (cellIndex < 0 || cellIndex > 8)
            return "Cell index out of range.";

        lock (_lock)
        {
            if (!_gamesById.TryGetValue(gameId, out var game))
                return "Game not found.";

            if (game.State.Status != GameStatus.InProgress)
                return "Game is not in progress.";

            if (game.GuestPlayer is null)
                return "Opponent not joined yet.";

            var isHost = game.HostPlayer == player;
            var isGuest = game.GuestPlayer == player;

            if (!isHost && !isGuest)
                return "Player is not part of this game.";

            if (game.State.NextTurnPlayer != player)
                return "Not your turn.";

            if (game.State.Board[cellIndex] != Cell.Empty)
                return "Cell already taken.";

            // Make the move
            var board = (Cell[])game.State.Board.Clone();
            var mark = isHost ? Cell.X : Cell.O;
            board[cellIndex] = mark;

            // Check for winner
            var winner = CheckWinner(board);
            var hasWinner = winner != Cell.Empty;

            // Check for draw (all cells filled and no winner)
            var isDraw = !hasWinner && board.All(c => c != Cell.Empty);

            // Determine new state
            var status = GameStatus.InProgress;
            string? nextTurn = isHost ? game.GuestPlayer : game.HostPlayer;
            string? winnerPlayer = null;

            if (hasWinner)
            {
                status = GameStatus.Finished;
                nextTurn = null;
                winnerPlayer = winner == Cell.X ? game.HostPlayer : game.GuestPlayer;
            }
            else if (isDraw)
            {
                status = GameStatus.Finished;
                nextTurn = null;
            }

            var updated = game with
            {
                State = new GameState(
                    Board: board,
                    NextTurnPlayer: nextTurn,
                    Status: status,
                    WinnerPlayer: winnerPlayer)
            };

            _gamesById[gameId] = updated;
            return updated;
        }
    }

    private static Cell CheckWinner(Cell[] board)
    {
        // Define all winning combinations
        int[][] winPatterns = new[]
        {
        new[] { 0, 1, 2 }, 
        new[] { 3, 4, 5 }, 
        new[] { 6, 7, 8 }, 
        new[] { 0, 3, 6 }, 
        new[] { 1, 4, 7 }, 
        new[] { 2, 5, 8 }, 
        new[] { 0, 4, 8 }, 
        new[] { 2, 4, 6 }  
    };

        foreach (var pattern in winPatterns)
        {
            var first = board[pattern[0]];

            if (first != Cell.Empty &&
                first == board[pattern[1]] &&
                first == board[pattern[2]])
            {
                return first;
            }
        }

        return Cell.Empty;
    }

    public IReadOnlyCollection<Game> GetAll() => _gamesById.Values.ToArray();

    public IReadOnlyCollection<Game> GetWaitingForOpponent() =>
    _gamesById.Values
        .Where(g => g.State.Status == GameStatus.WaitingForOpponent ||
                    g.State.Status == GameStatus.InProgress)
        .OrderBy(g => g.FriendlyName)
        .ToArray();

    public Result<Game> CancelGame(string gameId, string player)
    {
        if (string.IsNullOrWhiteSpace(gameId))
            return "Game id is required.";

        if (string.IsNullOrWhiteSpace(player))
            return "Player is required.";

        lock (_lock)
        {
            if (!_gamesById.TryGetValue(gameId, out var game))
                return "Game not found.";

            if (game.HostPlayer != player)
                return "Only the host can cancel the game.";

            if (game.State.Status != GameStatus.WaitingForOpponent)
                return "Can only cancel games that haven't started yet.";

            _gamesById.TryRemove(gameId, out _);
            return game;
        }
    }
}
