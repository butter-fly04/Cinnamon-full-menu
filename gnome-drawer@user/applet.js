/**
 * App Drawer Applet for Cinnamon
 * uuid: gnome-drawer@user
 */

const Applet         = imports.ui.applet;
const PopupMenu      = imports.ui.popupMenu;
const St             = imports.gi.St;
const Gio            = imports.gi.Gio;
const GLib           = imports.gi.GLib;
const Clutter        = imports.gi.Clutter;
const Main           = imports.ui.main;
const Gdk            = imports.gi.Gdk;

const UUID        = 'gnome-drawer@user';
const DATA_DIR    = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'cinnamon', 'applets', UUID]);
const STATE_FILE  = GLib.build_filenamev([DATA_DIR, 'drawer-state.json']);

function loadState() {
    try {
        const f = Gio.File.new_for_path(STATE_FILE);
        const [ok, bytes] = f.load_contents(null);
        if (ok) return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {}
    return { order: {}, pinned: [] };
}

function saveState(state) {
    try {
        GLib.mkdir_with_parents(DATA_DIR, 0o755);
        const f = Gio.File.new_for_path(STATE_FILE);
        const json = JSON.stringify(state, null, 2);
        f.replace_contents(json, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (e) {
        global.logError(`[AppDrawer] saveState: ${e}`);
    }
}

function getInstalledApps() {
    const apps = [];
    Gio.AppInfo.get_all().forEach(info => {
        if (!info.should_show()) return;
        const cats = (info.get_categories() || '').split(';').filter(Boolean);
        apps.push({
            id:         info.get_id(),
            name:       info.get_display_name() || info.get_name(),
            icon:       info.get_icon(),
            categories: cats,
            description: info.get_description() || '',
            keywords:   info.get_keywords() || [],
            appInfo:    info,
        });
    });
    apps.sort((a, b) => a.name.localeCompare(b.name));
    return apps;
}

function categoryToGroup(cats) {
    // Comprehensive XDG category mapping
    const map = {
        // Internet / Network
        'Network':        'Internet',
        'WebBrowser':     'Internet',
        'Email':          'Internet',
        'Chat':           'Internet',
        'IRCClient':      'Internet',
        'Feed':           'Internet',
        'FileTransfer':   'Internet',
        'P2P':            'Internet',
        'RemoteAccess':   'Internet',
        // System
        'System':         'System',
        'Settings':       'System',
        'PackageManager': 'System',
        'HardwareSettings': 'System',
        'Security':       'System',
        // Accessories / Utilities
        'Utility':        'Accessories',
        'Accessories':    'Accessories',
        'Calculator':     'Accessories',
        'Calendar':       'Accessories',
        'Clock':          'Accessories',
        'TextEditor':     'Accessories',
        'Archiving':      'Accessories',
        'FileManager':    'Accessories',
        'TerminalEmulator': 'Accessories',
        'X-GNOME-Utilities': 'Accessories',
        // Graphics
        'Graphics':       'Graphics',
        'Photography':    'Graphics',
        'Scanner':        'Graphics',
        '2DGraphics':     'Graphics',
        '3DGraphics':     'Graphics',
        'RasterGraphics': 'Graphics',
        'VectorGraphics': 'Graphics',
        'Viewer':         'Graphics',
        // Multimedia
        'AudioVideo':     'Multimedia',
        'Audio':          'Multimedia',
        'Video':          'Multimedia',
        'Music':          'Multimedia',
        'Player':         'Multimedia',
        'Recorder':       'Multimedia',
        'DiscBurning':    'Multimedia',
        'Midi':           'Multimedia',
        'Mixer':          'Multimedia',
        'Sequencer':      'Multimedia',
        'Tuner':          'Multimedia',
        'TV':             'Multimedia',
        // Development
        'Development':    'Development',
        'IDE':            'Development',
        'Debugger':       'Development',
        'Profiling':      'Development',
        'RevisionControl': 'Development',
        'Building':       'Development',
        'Translation':    'Development',
        'Documentation':  'Development',
        'WebDevelopment': 'Development',
        'GUIDesigner':    'Development',
        // Games
        'Game':           'Games',
        'ArcadeGame':     'Games',
        'BoardGame':      'Games',
        'CardGame':       'Games',
        'KidsGame':       'Games',
        'StrategyGame':   'Games',
        'PuzzleGame':     'Games',
        'RolePlaying':    'Games',
        'Simulation':     'Games',
        'SportsGame':     'Games',
        // Office
        'Office':         'Office',
        'Calendar':       'Office',
        'ContactManagement': 'Office',
        'Database':       'Office',
        'Dictionary':     'Office',
        'Chart':          'Office',
        'Email':          'Office',
        'Finance':        'Office',
        'FlowChart':      'Office',
        'PDA':            'Office',
        'ProjectManagement': 'Office',
        'Presentation':   'Office',
        'Spreadsheet':    'Office',
        'WordProcessor':  'Office',
        // Education
        'Education':      'Education',
        'Science':        'Education',
        'Astronomy':      'Education',
        'Biology':        'Education',
        'Chemistry':      'Education',
        'Geography':      'Education',
        'Geology':        'Education',
        'Math':           'Education',
        'Physics':        'Education',
        'MedicalSoftware':'Education',
        'Art':            'Education',
        'Languages':      'Education',
        'Teaching':       'Education',
    };
    for (const c of cats) {
        if (map[c]) return map[c];
    }
    return 'Other';
}

const STANDARD_GROUPS = [
    'All', 'Internet', 'System', 'Accessories', 'Graphics',
    'Multimedia', 'Development', 'Games', 'Office', 'Education', 'Other'
];

class AppDrawerApplet extends Applet.TextIconApplet {

    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.set_applet_icon_symbolic_name('view-app-grid-symbolic');
        this.set_applet_label('');
        this.set_applet_tooltip('App Drawer');

        this._state        = loadState();
        this._allApps      = [];
        this._currentGroup = 'All';
        this._searchText   = '';
        this._popupWidth   = 600;
        this._popupHeight  = 400;

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu        = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this._workarea = { x: 0, y: 0, width: 800, height: 600 };
        this._updateWorkarea();

        this._buildUI();
        this._loadApps();

        // Setup global key handler on the menu actor
        this._keyHandlerId = this.menu.actor.connect('key-press-event', (actor, event) => this._onKeyPress(event));
    }

    _updateWorkarea() {
        try {
            const display = Gdk.Display.get_default();
            if (display) {
                const monitor = display.get_primary_monitor();
                if (monitor) {
                    const rect = monitor.get_workarea();
                    this._workarea = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }
            }
        } catch (e) {}
    }

    _buildUI() {
        const section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(section);

        this._root = new St.BoxLayout({
            name:        'drawer-popup',
            vertical:    true,
            style_class: 'drawer-popup',
            clip_to_allocation: true,
        });
        section.actor.add_actor(this._root);

        // Search bar
        this._searchEntry = new St.Entry({
            name:        'search-entry',
            hint_text:   'Search applications…',
            can_focus:   true,
        });
        this._searchEntry.set_x_expand(true);
        this._searchEntry.get_clutter_text().connect('text-changed', () => {
            this._searchText = this._searchEntry.get_text().toLowerCase().trim();
            if (this._searchText) this._currentGroup = 'All';
            this._renderTabs();
            this._renderGrid();
            this._maybeMarkFirstResult();
        });
        this._root.add_actor(this._searchEntry);

        // Group tabs
        this._tabBox = new St.BoxLayout({
            style_class: 'group-tab-box',
            vertical:    false,
        });
        this._root.add_actor(this._tabBox);

        // Scrollable grid
        this._scrollView = new St.ScrollView({
            style_class: 'drawer-scroll-view',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            y_expand: true,
            x_expand: true,
            clip_to_allocation: true,
        });

        this._gridBox = new St.BoxLayout({
            name:     'apps-grid',
            vertical: true,
            y_align:  Clutter.ActorAlign.START,
            x_expand: true,
        });
        this._scrollView.add_actor(this._gridBox);
        this._root.add_actor(this._scrollView);

        // Grid navigation state
        this._currentFilteredApps = [];
        this._gridButtons = [];   // 2D array of button actors
        this._focusedRow = -1;
        this._focusedCol = -1;
        this._firstResultExists = false;
    }

    _loadApps() {
        this._allApps = getInstalledApps().map((app, i) => {
            const group = categoryToGroup(app.categories);
            const order = this._state.order[app.id] ?? i;
            const pinned = this._state.pinned.includes(app.id);
            return { ...app, group, order, pinned };
        });
        this._allApps.sort((a, b) => a.order - b.order);

        const usedGroups = new Set(['All']);
        this._allApps.forEach(a => usedGroups.add(a.group));
        this._groups = STANDARD_GROUPS.filter(g => usedGroups.has(g));

        this._renderTabs();
        this._renderGrid();
    }

    _renderTabs() {
        this._tabBox.destroy_all_children();
        this._groups.forEach(g => {
            const btn = new St.Button({
                label:       g,
                style_class: 'group-tab' + (g === this._currentGroup ? ' active' : ''),
                can_focus:   true,
            });
            btn.connect('clicked', () => {
                this._currentGroup = g;
                this._renderTabs();
                this._renderGrid();
                this._maybeMarkFirstResult();
            });
            this._tabBox.add_actor(btn);
        });
    }

    _filteredApps() {
        let list = this._allApps.slice();
        if (this._searchText) {
            const term = this._searchText;
            list = list.filter(a => {
                const nameMatch = a.name.toLowerCase().includes(term);
                const descMatch = a.description && a.description.toLowerCase().includes(term);
                const kwMatch = a.keywords && a.keywords.some(kw => kw.toLowerCase().includes(term));
                return nameMatch || descMatch || kwMatch;
            });
        } else if (this._currentGroup !== 'All') {
            list = list.filter(a => a.group === this._currentGroup);
        }
        return list;
    }

    _renderGrid() {
        this._gridBox.destroy_all_children();
        const list = this._filteredApps();
        this._currentFilteredApps = list;
        this._gridButtons = [];

        if (list.length === 0) {
            const empty = new St.Label({
                text: 'No apps found',
                style_class: 'drawer-empty-label',
            });
            this._gridBox.add_actor(empty);
            this._firstResultExists = false;
            return;
        }

        // Calculate columns
        const contentWidth = Math.max(this._popupWidth - 32 - 8 - 8, 300);
        const buttonTotal = 105;
        const spacing = 4;
        const cols = Math.max(4, Math.floor((contentWidth + spacing) / (buttonTotal + spacing)));

        for (let r = 0; r < list.length; r += cols) {
            const row = new St.BoxLayout({
                style_class: 'app-row',
                vertical: false,
                x_expand: true,
            });

            const leftSpacer = new St.Widget({ x_expand: true });
            const rightSpacer = new St.Widget({ x_expand: true });
            row.add_actor(leftSpacer);

            const rowButtons = [];
            const end = Math.min(r + cols, list.length);
            for (let i = r; i < end; i++) {
                const btn = this._makeAppButton(list[i]);
                row.add_actor(btn);
                rowButtons.push(btn);
            }
            this._gridButtons.push(rowButtons);
            row.add_actor(rightSpacer);
            this._gridBox.add_actor(row);
        }

        // Reset focus state (no button has keyboard focus)
        if (this._focusedRow !== -1 && this._focusedCol !== -1) {
            const oldRow = this._gridButtons[this._focusedRow];
            if (oldRow && oldRow[this._focusedCol]) {
                oldRow[this._focusedCol].remove_style_pseudo_class('focus');
            }
        }
        this._focusedRow = -1;
        this._focusedCol = -1;
        this._firstResultExists = (this._gridButtons.length > 0 && this._gridButtons[0].length > 0);
    }

    _makeAppButton(app) {
        const btn = new St.Button({
            style_class: 'app-button',
            reactive: true,
            can_focus: true,
        });
        btn._app = app;

        const col = new St.BoxLayout({ vertical: true, style: 'align-items:center;' });

        const icon = new St.Icon({
            style_class: 'app-icon',
            icon_size:   48,
        });
        if (app.icon) {
            icon.set_gicon(app.icon);
        } else {
            icon.set_icon_name('application-x-executable');
        }

        const label = new St.Label({
            style_class: 'app-button-label',
            text: app.name.length > 16 ? app.name.slice(0, 15) + '…' : app.name,
        });
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = true;

        col.add_actor(icon);
        col.add_actor(label);
        btn.add_actor(col);

        btn.connect('clicked', () => {
            this._launchApp(app);
        });

        return btn;
    }

    _launchApp(app) {
        try {
            app.appInfo.launch([], null);
            this.menu.close();
        } catch (e) {
            global.logError(`[AppDrawer] launch ${app.id}: ${e}`);
        }
    }

    _maybeMarkFirstResult() {
        this._firstResultExists = (this._gridButtons.length > 0 && this._gridButtons[0].length > 0);
        // Optionally, you could style the first button differently here,
        // but we intentionally do NOT grab focus.
    }

    _focusButton(row, col) {
        if (row < 0 || row >= this._gridButtons.length) return;
        const rowButtons = this._gridButtons[row];
        if (col < 0 || col >= rowButtons.length) return;
        const btn = rowButtons[col];
        if (!btn) return;

        // Remove focus style from previously focused button
        if (this._focusedRow !== -1 && this._focusedCol !== -1) {
            const oldRow = this._gridButtons[this._focusedRow];
            if (oldRow && oldRow[this._focusedCol]) {
                oldRow[this._focusedCol].remove_style_pseudo_class('focus');
            }
        }

        this._focusedRow = row;
        this._focusedCol = col;
        btn.add_style_pseudo_class('focus');
        btn.grab_key_focus();

        // Scroll into view
        this._scrollView.scroll_to_actor(btn);
    }

    _onKeyPress(event) {
        if (!this.menu.isOpen) return false;

        const symbol = event.get_key_symbol();
        const focusActor = global.stage.get_key_focus();
        const isSearchFocused = (focusActor === this._searchEntry);

        // Escape → close menu
        if (symbol === Clutter.KEY_Escape) {
            this.menu.close();
            return true;
        }

        // Enter / Return
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            if (isSearchFocused && this._firstResultExists) {
                // Launch first app
                const firstBtn = this._gridButtons[0][0];
                if (firstBtn && firstBtn._app) {
                    this._launchApp(firstBtn._app);
                    return true;
                }
            } else if (!isSearchFocused && this._focusedRow !== -1 && this._focusedCol !== -1) {
                const btn = this._gridButtons[this._focusedRow][this._focusedCol];
                if (btn && btn._app) {
                    this._launchApp(btn._app);
                    return true;
                }
            }
            return false;
        }

        // Arrow keys
        if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down ||
            symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {

            // If no grid buttons, ignore arrows
            if (this._gridButtons.length === 0 || this._gridButtons[0].length === 0)
                return false;

            // Special case: search has focus and user presses Down → move to first button
            if (isSearchFocused && symbol === Clutter.KEY_Down && this._firstResultExists) {
                this._focusButton(0, 0);
                return true;
            }

            // If no button currently focused, ignore arrows (except Down handled above)
            if (this._focusedRow === -1) return false;

            let newRow = this._focusedRow;
            let newCol = this._focusedCol;

            switch (symbol) {
                case Clutter.KEY_Up:
                    if (newRow > 0) {
                        newRow--;
                        const targetRowLen = this._gridButtons[newRow].length;
                        if (newCol >= targetRowLen) newCol = targetRowLen - 1;
                    } else {
                        // Move focus up to search entry
                        this._searchEntry.grab_key_focus();
                        // Clear button focus style
                        const btn = this._gridButtons[this._focusedRow][this._focusedCol];
                        if (btn) btn.remove_style_pseudo_class('focus');
                        this._focusedRow = -1;
                        this._focusedCol = -1;
                        return true;
                    }
                    break;
                case Clutter.KEY_Down:
                    if (newRow < this._gridButtons.length - 1) {
                        newRow++;
                        const targetRowLen = this._gridButtons[newRow].length;
                        if (newCol >= targetRowLen) newCol = targetRowLen - 1;
                    } else {
                        return true; // at bottom, do nothing
                    }
                    break;
                case Clutter.KEY_Left:
                    if (newCol > 0) newCol--;
                    else if (newRow > 0) {
                        newRow--;
                        newCol = this._gridButtons[newRow].length - 1;
                    } else return true;
                    break;
                case Clutter.KEY_Right:
                    if (newCol < this._gridButtons[newRow].length - 1) newCol++;
                    else if (newRow < this._gridButtons.length - 1) {
                        newRow++;
                        newCol = 0;
                    } else return true;
                    break;
                default: return false;
            }
            this._focusButton(newRow, newCol);
            return true;
        }

        return false;
    }

    on_applet_clicked() {
        if (this.menu.isOpen) {
            this.menu.close();
        } else {
            this._updateWorkarea();
            this._popupWidth = Math.max(this._workarea.width - 40, 600);
            this._popupHeight = Math.max(this._workarea.height - 40, 400);

            this._root.set_size(this._popupWidth, this._popupHeight);
            this.menu.actor.set_size(this._popupWidth, this._popupHeight);

            this._loadApps();
            this.menu.open();
            this._searchEntry.set_text('');
            this._searchEntry.grab_key_focus();
        }
    }

    on_applet_removed_from_panel() {
        if (this._keyHandlerId) {
            this.menu.actor.disconnect(this._keyHandlerId);
        }
        this.menu.destroy();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new AppDrawerApplet(metadata, orientation, panelHeight, instanceId);
}
