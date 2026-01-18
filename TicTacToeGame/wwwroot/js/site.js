// TicTacToe - Client-side JavaScript
// Organized into modules: Storage, UI Helpers, SignalR, Display Name, Lobby, Game

(function () {
    'use strict';

    // =========================================================================
    // Storage - sessionStorage wrapper for per-tab display name
    // =========================================================================
    var Storage = {
        DISPLAY_NAME_KEY: 'tictactoe.displayName',

        getDisplayName: function () {
            try {
                var v = sessionStorage.getItem(this.DISPLAY_NAME_KEY);
                return v ? v.trim() : '';
            } catch {
                return '';
            }
        },

        setDisplayName: function (value) {
            try {
                sessionStorage.setItem(this.DISPLAY_NAME_KEY, (value || '').trim());
            } catch {
                // ignore
            }
        }
    };

    // =========================================================================
    // UI Helpers - DOM manipulation utilities
    // =========================================================================
    var UI = {
        setAlertText: function (id, text) {
            var el = document.getElementById(id);
            if (el) el.textContent = text;
        },

        showError: function (id, msg) {
            var el = document.getElementById(id);
            if (!el) return;
            el.textContent = msg;
            el.hidden = false;
        },

        hideError: function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.hidden = true;
            el.textContent = '';
        },

        setDisabled: function (id, disabled) {
            var el = document.getElementById(id);
            if (el) el.disabled = disabled;
        }
    };

    // =========================================================================
    // SignalR - Hub connection management
    // =========================================================================
    var Hub = {
        connection: null,
        startPromise: null,
        eventHandlers: [], // Store handlers to re-register after reset

        ensureConnection: async function () {
            if (!window.signalR) {
                throw new Error('SignalR client not loaded.');
            }

            var displayName = Storage.getDisplayName();

            if (this.connection) {
                var state = this.connection.state;

                if (state === signalR.HubConnectionState.Connected) {
                    return this.connection;
                }

                if (state === signalR.HubConnectionState.Connecting ||
                    state === signalR.HubConnectionState.Reconnecting) {
                    if (this.startPromise) await this.startPromise;
                    return this.connection;
                }

                // Disconnected - restart
                this.startPromise = this.connection.start();
                await this.startPromise;
                return this.connection;
            }

            // Create new connection
            this.connection = new signalR.HubConnectionBuilder()
                .withUrl('/tictactoeHub?displayName=' + encodeURIComponent(displayName))
                .withAutomaticReconnect()
                .build();

            // Re-register all stored event handlers
            this.eventHandlers.forEach(function (h) {
                this.connection.on(h.event, h.handler);
            }, this);

            this.startPromise = this.connection.start();
            await this.startPromise;

            return this.connection;
        },

        on: function (eventName, handler) {
            // Store for re-registration after reset
            this.eventHandlers.push({ event: eventName, handler: handler });

            // Register immediately if connection exists
            if (this.connection) {
                this.connection.on(eventName, handler);
            }
        },

        invoke: async function (methodName) {
            var connection = await this.ensureConnection();
            var args = Array.prototype.slice.call(arguments, 1);
            return connection.invoke.apply(connection, [methodName].concat(args));
        },

        reset: async function () {
            if (this.connection) {
                try {
                    await this.connection.stop();
                } catch {
                    // ignore
                }
                this.connection = null;
                this.startPromise = null;
            }
            // Note: eventHandlers are preserved so they get re-registered on next ensureConnection
        }
    };

    // =========================================================================
    // Display Name Module - Modal and identity management
    // =========================================================================
    var DisplayNameModule = {
        init: function (onNameSet) {
            var modalEl = document.getElementById('displayNameModal');
            if (!modalEl) return;

            var inputEl = document.getElementById('displayNameInput');
            var saveBtn = document.getElementById('displayNameSaveBtn');
            var form = document.getElementById('displayNameForm');

            if (Storage.getDisplayName()) return; // Already has name

            var modal = new bootstrap.Modal(modalEl, {
                backdrop: 'static',
                keyboard: false
            });
            modal.show();

            setTimeout(function () {
                if (inputEl) inputEl.focus();
            }, 150);

            var onSave = async function () {
                UI.hideError('displayNameError');

                var name = inputEl ? inputEl.value.trim() : '';
                if (!name) {
                    UI.showError('displayNameError', 'Please enter a display name.');
                    return;
                }
                if (name.length > 32) {
                    name = name.substring(0, 32);
                }

                Storage.setDisplayName(name);
                modal.hide();

                // Reset connection so new displayName is sent via query string
                await Hub.reset();

                if (onNameSet) {
                    await onNameSet();
                }
            };

            if (saveBtn) {
                saveBtn.addEventListener('click', onSave);
            }
            if (form) {
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    onSave();
                });
            }
        },

        refreshUI: function () {
            var name = Storage.getDisplayName();
            var hasName = !!name;

            var currentNameEl = document.getElementById('currentDisplayName');
            var currentNameValueEl = document.getElementById('currentDisplayNameValue');

            if (currentNameValueEl) currentNameValueEl.textContent = name;
            if (currentNameEl) currentNameEl.hidden = !hasName;

            UI.setDisabled('createGameBtn', !hasName);

            document.querySelectorAll('.js-join-game').forEach(function (btn) {
                btn.disabled = !hasName;
            });

            document.querySelectorAll('.js-cancel-game').forEach(function (btn) {
                btn.disabled = !hasName;
            });
        }
    };

    // =========================================================================
    // Lobby Module - Game list and create/join functionality
    // =========================================================================
    var LobbyModule = {
        renderWaitingGames: function (games) {
            var container = document.getElementById('waitingGamesList');
            if (!container) return;

            var hasName = !!Storage.getDisplayName();
            var currentPlayer = Storage.getDisplayName();

            if (!games || games.length === 0) {
                container.innerHTML = '<p class="text-muted">No games available.</p>';
                return;
            }

            var html = '<div class="list-group">';
            games.forEach(function (g) {
                var isCreator = g.hostPlayer === currentPlayer;
                var isParticipant = g.hostPlayer === currentPlayer || g.guestPlayer === currentPlayer;

                html += '<div class="list-group-item d-flex justify-content-between align-items-center">'
                    + '<div>'
                    + '<div class="fw-semibold"></div>'
                    + '<small class="text-muted game-id"></small>';

                if (isCreator) {
                    html += '<small class="text-success d-block">You created this game</small>';
                } else if (isParticipant) {
                    html += '<small class="text-info d-block">You are playing in this game</small>';
                }

                html += '</div><div class="btn-group">';

                if (isParticipant) {
                    html += '<button type="button" class="btn btn-sm btn-outline-success js-rejoin-game" '
                        + 'data-game-id="" ' + (hasName ? '' : 'disabled') + '>Rejoin</button>';

                    if (isCreator && g.status === 'WaitingForOpponent') {
                        html += '<button type="button" class="btn btn-sm btn-outline-danger js-cancel-game" '
                            + 'data-game-id="" ' + (hasName ? '' : 'disabled') + '>Cancel</button>';
                    }
                } else {
                    html += '<button type="button" class="btn btn-sm btn-outline-primary js-join-game" '
                        + 'data-game-id="" ' + (hasName ? '' : 'disabled') + '>Join</button>';
                }

                html += '</div></div>';
            });
            html += '</div>';

            container.innerHTML = html;

            // Fill in text content safely
            var items = container.querySelectorAll('.list-group-item');
            items.forEach(function (item, idx) {
                var g = games[idx];
                item.querySelector('.fw-semibold').textContent = g.friendlyName;
                item.querySelector('.game-id').textContent = 'Id: ' + g.gameId;

                var joinBtn = item.querySelector('.js-join-game');
                var rejoinBtn = item.querySelector('.js-rejoin-game');
                var cancelBtn = item.querySelector('.js-cancel-game');

                if (joinBtn) joinBtn.setAttribute('data-game-id', g.gameId);
                if (rejoinBtn) rejoinBtn.setAttribute('data-game-id', g.gameId);
                if (cancelBtn) cancelBtn.setAttribute('data-game-id', g.gameId);
            });
        },

        init: async function () {
            var container = document.getElementById('waitingGamesList');
            var createForm = document.getElementById('createGameForm');

            if (!container && !createForm) return;

            // Register event handlers BEFORE ensuring connection
            Hub.on('LobbyUpdated', function (payload) {
                LobbyModule.renderWaitingGames(payload.waitingGames);
                DisplayNameModule.refreshUI();
            });

            Hub.on('GameCreated', function (payload) {
                window.location.href = '/Game/' + payload.gameId;
            });

            Hub.on('GameJoined', function (payload) {
                window.location.href = '/Game/' + payload.gameId;
            });

            Hub.on('GameCancelled', function (payload) {
                var successEl = document.getElementById('joinGameSuccess');
                if (successEl) {
                    successEl.textContent = 'Game cancelled successfully.';
                    successEl.classList.remove('alert-danger');
                    successEl.classList.add('alert-success');
                    successEl.hidden = false;

                    setTimeout(function () {
                        successEl.hidden = true;
                    }, 3000);
                }
            });

            try {
                await Hub.ensureConnection();

                // Initial load
                await Hub.invoke('GetLobby');

                // Create game form
                if (createForm) {
                    createForm.addEventListener('submit', this.handleCreateGame.bind(this));
                }

                // Event delegation for join, rejoin, and cancel buttons
                document.addEventListener('click', this.handleGameActions.bind(this));

            } catch {
                // ignore connection errors
            }
        },

        handleCreateGame: async function (e) {
            e.preventDefault();
            UI.hideError('createGameError');

            var input = document.getElementById('friendlyNameInput');
            var gameName = input ? input.value.trim() : '';

            if (!gameName) {
                UI.showError('createGameError', 'Please enter a game name.');
                return;
            }

            try {
                UI.setDisabled('createGameBtn', true);
                await Hub.invoke('CreateGame', gameName);
            } catch (err) {
                UI.showError('createGameError', err && err.message ? err.message : 'Failed to create game.');
            } finally {
                UI.setDisabled('createGameBtn', false);
            }
        },

        handleGameActions: async function (e) {
            var target = e.target;
            if (!target || !target.classList) return;

            var gameId = target.getAttribute('data-game-id');
            if (!gameId) return;

            // Handle Join Game
            if (target.classList.contains('js-join-game')) {
                try {
                    await Hub.invoke('JoinGame', gameId);
                } catch (err) {
                    var errorEl = document.getElementById('joinGameSuccess');
                    if (errorEl) {
                        errorEl.textContent = err && err.message ? err.message : 'Failed to join game.';
                        errorEl.classList.remove('alert-success');
                        errorEl.classList.add('alert-danger');
                        errorEl.hidden = false;
                    }
                }
            }

            // Handle Rejoin Game
            if (target.classList.contains('js-rejoin-game')) {
                window.location.href = '/Game/' + gameId;
            }

            // Handle Cancel Game
            if (target.classList.contains('js-cancel-game')) {
                if (!confirm('Are you sure you want to cancel this game?')) return;

                try {
                    await Hub.invoke('CancelGame', gameId);
                } catch (err) {
                    var errorEl = document.getElementById('joinGameSuccess');
                    if (errorEl) {
                        errorEl.textContent = err && err.message ? err.message : 'Failed to cancel game.';
                        errorEl.classList.remove('alert-success');
                        errorEl.classList.add('alert-danger');
                        errorEl.hidden = false;
                    }
                }
            }
        }
    };

    // =========================================================================
    // Game Module - Board and gameplay
    // =========================================================================
    var GameModule = {
        state: null,
        cellButtons: null,
        redirectTimeout: null,
        countdownInterval: null,
        redirectSeconds: 10,

        init: async function () {
            if (!window.ticTacToeGame || !document.getElementById('board')) return;

            var displayName = Storage.getDisplayName();
            if (!displayName) {
                window.location.href = '/';
                return;
            }

            var gameData = window.ticTacToeGame;
            var isHost = displayName === gameData.hostPlayer;
            var isGuest = displayName === gameData.guestPlayer;

            // Determine player mark (host = X, guest = O)
            var playerMark = '?';
            var playerMarkText = '?';

            if (isHost) {
                playerMark = 'X';
                playerMarkText = 'X (Host)';
            } else if (isGuest) {
                playerMark = 'O';
                playerMarkText = 'O (Guest)';
            } else {
                playerMarkText = 'Observer';
            }

            // Update UI with player mark immediately
            var markEl = document.getElementById('playerMarkDisplay');
            if (markEl) {
                markEl.textContent = playerMarkText;

                // Add color class
                markEl.classList.remove('text-primary', 'text-danger', 'text-muted');
                if (playerMark === 'X') {
                    markEl.classList.add('text-primary');
                } else if (playerMark === 'O') {
                    markEl.classList.add('text-danger');
                } else {
                    markEl.classList.add('text-muted');
                }
            }

            this.state = {
                gameId: gameData.gameId,
                playerId: displayName,
                playerMark: playerMark,
                status: 'WaitingForOpponent',
                nextTurnPlayerId: '',
                winnerPlayerId: ''
            };

            this.cellButtons = document.querySelectorAll('.js-cell');
            this.setCellsEnabled(false);
            UI.setAlertText('gameStatus', 'Connecting...');

            // Register handler before connection
            Hub.on('GameUpdated', this.handleGameUpdated.bind(this));

            try {
                await Hub.reset();
                await Hub.ensureConnection();

                await Hub.invoke('SubscribeGame', this.state.gameId);

                this.cellButtons.forEach(function (btn) {
                    btn.addEventListener('click', this.handleCellClick.bind(this));
                }, this);

            } catch (err) {
                UI.setAlertText('gameStatus', err && err.message ? err.message : 'Failed to connect to game.');
            }
        },

        handleGameUpdated: function (payload) {
            if (!payload || !this.state || payload.gameId !== this.state.gameId) return;

            this.applyBoard(payload.board);
            this.state.status = payload.status;
            this.state.nextTurnPlayerId = payload.nextTurnPlayerId || '';
            this.state.winnerPlayerId = payload.winnerPlayerId || '';

            this.updateStatusText();
            this.setCellsEnabled(
                this.state.status === 'InProgress' &&
                this.state.nextTurnPlayerId === this.state.playerId
            );

            // Auto-redirect after game ends
            if (this.state.status === 'Finished' && !this.redirectTimeout) {
                this.scheduleRedirect();
            }
        },

        handleCellClick: async function (e) {
            var btn = e.currentTarget;

            if (this.state.status !== 'InProgress') return;
            if (this.state.nextTurnPlayerId !== this.state.playerId) return;

            var idx = parseInt(btn.getAttribute('data-cell-index'), 10);

            try {
                this.setCellsEnabled(false);
                await Hub.invoke('MakeMove', this.state.gameId, idx);
            } catch (err) {
                UI.setAlertText('gameStatus', err && err.message ? err.message : 'Move failed.');
                this.setCellsEnabled(
                    this.state.status === 'InProgress' &&
                    this.state.nextTurnPlayerId === this.state.playerId
                );
            }
        },

        setCellsEnabled: function (enabled) {
            if (!this.cellButtons) return;
            this.cellButtons.forEach(function (btn) {
                btn.disabled = !enabled;
            });
        },

        applyBoard: function (board) {
            if (!board || !Array.isArray(board)) return;

            this.cellButtons.forEach(function (btn) {
                var idx = parseInt(btn.getAttribute('data-cell-index'), 10);
                var value = board[idx];

                if (value === 'X') {
                    btn.textContent = 'X';
                    btn.classList.remove('text-danger');
                    btn.classList.add('text-primary');
                } else if (value === 'O') {
                    btn.textContent = 'O';
                    btn.classList.remove('text-primary');
                    btn.classList.add('text-danger');
                } else {
                    btn.textContent = '';
                    btn.classList.remove('text-primary', 'text-danger');
                }
            });
        },

        updateStatusText: function () {
            var state = this.state;
            var statusEl = document.getElementById('gameStatus');

            // Reset classes
            if (statusEl) {
                statusEl.classList.remove('alert-info', 'alert-success', 'alert-danger');
            }

            if (state.status === 'WaitingForOpponent') {
                UI.setAlertText('gameStatus', 'Waiting for opponent...');
                if (statusEl) statusEl.classList.add('alert-info');
                return;
            }

            if (state.status === 'Finished') {
                var baseMessage = '';
                if (state.winnerPlayerId) {
                    if (state.winnerPlayerId === state.playerId) {
                        baseMessage = 'You won!';
                        if (statusEl) statusEl.classList.add('alert-success');
                    } else {
                        baseMessage = 'You lost.';
                        if (statusEl) statusEl.classList.add('alert-danger');
                    }
                } else {
                    baseMessage = 'Draw.';
                    if (statusEl) statusEl.classList.add('alert-info');
                }

                // Will be updated by countdown
                UI.setAlertText('gameStatus', baseMessage + ' Redirecting to lobby in ' + this.redirectSeconds + ' seconds...');
                return;
            }

            if (state.nextTurnPlayerId === state.playerId) {
                UI.setAlertText('gameStatus', 'Your turn.');
            } else {
                UI.setAlertText('gameStatus', "Opponent's turn.");
            }
            if (statusEl) statusEl.classList.add('alert-info');
        },

        scheduleRedirect: function () {
            var self = this;
            self.redirectSeconds = 10;

            // Update countdown every second
            self.countdownInterval = setInterval(function () {
                self.redirectSeconds--;

                if (self.redirectSeconds <= 0) {
                    clearInterval(self.countdownInterval);
                    return;
                }

                // Update status text with new countdown
                var baseMessage = '';
                if (self.state.winnerPlayerId) {
                    if (self.state.winnerPlayerId === self.state.playerId) {
                        baseMessage = 'You won!';
                    } else {
                        baseMessage = 'You lost.';
                    }
                } else {
                    baseMessage = 'Draw.';
                }

                UI.setAlertText('gameStatus', baseMessage + ' Redirecting to lobby in ' + self.redirectSeconds + ' seconds...');
            }, 1000);

            // Actual redirect after 10 seconds
            self.redirectTimeout = setTimeout(function () {
                clearInterval(self.countdownInterval);
                window.location.href = '/';
            }, 10000);
        }
    };

    // =========================================================================
    // App Initialization
    // =========================================================================
    document.addEventListener('DOMContentLoaded', async function () {
        DisplayNameModule.refreshUI();

        DisplayNameModule.init(async function () {
            DisplayNameModule.refreshUI();
            try {
                await Hub.invoke('GetLobby');
            } catch {
                // ignore
            }
        });

        // Initialize lobby (Home page)
        await LobbyModule.init();

        // Initialize game (Game page)
        await GameModule.init();
    });

})();