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
            appInfo:    info,
        });
    });
    apps.sort((a, b) => a.name.localeCompare(b.name));
    return apps;
}

function categoryToGroup(cats) {
    const map = {
        'Network':        'Internet',
        'WebBrowser':     'Internet',
        'Email':          'Internet',
        'System':         'System',
        'Settings':       'System',
        'Utility':        'Accessories',
        'Accessories':    'Accessories',
        'Graphics':       'Graphics',
        'Photography':    'Graphics',
        'AudioVideo':     'Multimedia',
        'Audio':          'Multimedia',
        'Video':          'Multimedia',
        'Development':    'Development',
        'IDE':            'Development',
        'Game':           'Games',
        'Office':         'Office',
        'Education':      'Education',
        'Science':        'Education',
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

        // Search bar - x_expand true so it fills popup width and doesn't overflow
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
        });
        this._root.add_actor(this._searchEntry);

        // Group tabs
        this._tabBox = new St.BoxLayout({
            style_class: 'group-tab-box',
            vertical:    false,
        });
        this._root.add_actor(this._tabBox);

        // Scrollable grid that fills remaining vertical space
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
            });
            btn.connect('clicked', () => {
                this._currentGroup = g;
                this._renderTabs();
                this._renderGrid();
            });
            this._tabBox.add_actor(btn);
        });
    }

    _filteredApps() {
        let list = this._allApps.slice();
        if (this._searchText) {
            list = list.filter(a => a.name.toLowerCase().includes(this._searchText));
        } else if (this._currentGroup !== 'All') {
            list = list.filter(a => a.group === this._currentGroup);
        }
        return list;
    }

    _renderGrid() {
        this._gridBox.destroy_all_children();
        const list = this._filteredApps();

        if (list.length === 0) {
            const empty = new St.Label({
                text: 'No apps found',
                style_class: 'drawer-empty-label',
            });
            this._gridBox.add_actor(empty);
            return;
        }

        // Calculate available width inside the popup content area:
        // popupWidth - root CSS padding (16*2) - scrollview padding (4*2) - safety (8)
        const contentWidth = Math.max(this._popupWidth - 32 - 8 - 8, 300);

        // Each button: CSS width 90px + padding 6*2 + border 1.5*2 = 105px total
        // Plus 4px spacing between buttons in the row
        // N buttons = 105*N + 4*(N-1) = 109*N - 4
        const buttonTotal = 105;
        const spacing = 4;
        const cols = Math.max(4, Math.floor((contentWidth + spacing) / (buttonTotal + spacing)));

        for (let r = 0; r < list.length; r += cols) {
            // Row fills full width, spacers center the buttons
            const row = new St.BoxLayout({
                style_class: 'app-row',
                vertical: false,
                x_expand: true,
            });

            const leftSpacer = new St.Widget({ x_expand: true });
            const rightSpacer = new St.Widget({ x_expand: true });

            row.add_actor(leftSpacer);
            list.slice(r, r + cols).forEach(app => {
                row.add_actor(this._makeAppButton(app));
            });
            row.add_actor(rightSpacer);

            this._gridBox.add_actor(row);
        }
    }

    _makeAppButton(app) {
        const btn = new St.Button({ style_class: 'app-button', reactive: true });
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
            try {
                app.appInfo.launch([], null);
                this.menu.close();
            } catch (e) {
                global.logError(`[AppDrawer] launch ${app.id}: ${e}`);
            }
        });

        return btn;
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
        this.menu.destroy();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new AppDrawerApplet(metadata, orientation, panelHeight, instanceId);
}
