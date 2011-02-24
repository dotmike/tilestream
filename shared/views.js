// Requires for the server-side context. *TODO* Note that `var` is omitted here
// because even within the `if()` IE will wipe globally defined variables if
// `var` is included, leaving us with broken objects.
if (typeof require !== 'undefined') {
    Bones = require('bones'),
    Settings = require('settings'),
    Backbone = require('backbone.js'),
    _ = require('underscore')._;
}

// PageView
// --------
// View representing the entire page viewport. The view that should "fill" the
// viewport should be passed as `options.view`. When the View's element has
// been successfully added to the DOM a `ready` event will be triggered on that
// view.
var PageView = Backbone.View.extend({
    initialize: function(options) {
        _.bindAll(this, 'render');
        this.render().trigger('attach');
    },
    render: function() {
        // Server side.
        if (Bones.server) {
            this.el = this.template('PageView', {
                content: this.options.view.html()
            });
            return this;
        }
        // Client side.
        $('#app').html(this.options.view.el);
        this.options.view.trigger('ready');
        return this;
    }
});

// ErrorView
// ---------
// Error view.
var ErrorView = Backbone.View.extend({
    initialize: function(options) {
        _.bindAll(this, 'render');
        this.render().trigger('attach');
    },
    render: function() {
        $(this.el).html(this.template('ErrorView', {
            message: this.options.message
        }));
        return this;
    }
});

// OpenLayersView
// --------------
//
var OpenLayersView = Backbone.View.extend({
    id: 'openlayers-map',
    initialize: function(options) {
        _.bindAll(this, 'ready');
    },
    ready: function() {
        $(this.el).attr('src', this.waxURL(this.generateWax()));
        $(this.el).each(OpenLayersWax.bind);
    },
    waxURL: function(wax) {
        return '/wax.json?' + $.param(wax);
    },
    generateWax: function(callback) {
        var wax = {
            el: $(this.el).attr('id'),
            layers: [this.model.id],
            center: [this.model.get('center').lon, this.model.get('center').lat],
            zoom: 0
        };
        if (this.model.get('type') === 'overlay') {
            if (this.model.get('baselayer')) {
                var baselayer = this.model.get('baselayer');
                // Ensure the zoom levels of the baselayer intersect with those
                // of the overlay.
                if (
                    _.intersect(
                        _.range(this.model.get('minzoom'), this.model.get('maxzoom')),
                        _.range(baselayer.get('minzoom'), baselayer.get('maxzoom'))
                    ).length === 0
                ) {
                    var view = new ErrorView({
                      message: 'The default baselayer does not cover enough zoom levels.'
                    });
                    new PageView({ view: view });
                }
                wax.layers.push(baselayer.id);
            }
            else {
                var view = new ErrorView({ message: 'No default baselayer set.' });
                new PageView({ view: view });
            }
        }
        wax.zoom = this.model.get('minzoom') < 2 ? 2 : 0;
        return wax;
    },
});

// TilesetView
// -------
// View for exploring a single Tileset. Provides a fullscreen OpenLayers UI with
// HUD panels for enabled features (e.g. info, download, etc.)
var TilesetView = Backbone.View.extend({
    initialize: function(options) {
        _.bindAll(this, 'render', 'ready', 'controlZoom', 'format');
        this.render().trigger('attach');
    },
    events: {
        'click .buttons a': 'hud'
    },
    hud: function(ev) {
        var that = this;
        var link = $(ev.currentTarget);
        var hud = !link.is('.active')
            ? link.attr('href').split('#').pop()
            : false;

        // Start by hiding active HUDs.
        this.$('.buttons .active').removeClass('active');
        this.$('.hud.active').removeClass('active').fadeOut();

        // If a HUD for activation has been specified, activate it.
        if (hud) {
            link.addClass('active');
            that.$('.hud.' + hud).fadeIn(function() {
                $(this).addClass('active');
            });
        }
        return false;
    },
    format: function(type, value) {
        switch (type) {
        case 'deg':
            return parseInt(value * 100, 10) * .01;
            break;
        case 'url':
            var that = this;
            return _.map(this.model.layerURL(), function(layer) {
                return layer + '1.0.0/' + that.model.get('id') + '/{z}/{x}/{y}';
            });
            break;
        case 'download':
            return this.model.layerURL()[0]
                + 'download/'
                + this.model.get('id')
                + '.mbtiles';
            break;
        case 'size':
            return (Math.ceil(parseInt(this.model.get('size')) / 1048576)) + ' MB';
            break;
        }
    },
    render: function() {
        $(this.el).html(this.template('TilesetView', {
            features: Settings.features,
            id: this.model.get('id'),
            name: this.model.get('name'),
            zoom: _.range(this.model.get('minzoom'), this.model.get('maxzoom') + 1),
            description: this.model.get('description') || null,
            type: this.model.get('type') || null,
            bounds: {
                w: this.format('deg', this.model.get('bounds')[0]),
                s: this.format('deg', this.model.get('bounds')[1]),
                e: this.format('deg', this.model.get('bounds')[2]),
                n: this.format('deg', this.model.get('bounds')[3])
            },
            url: this.format('url'),
            download: this.format('download'),
            size: this.format('size')
        }));

        this.map = new OpenLayersView({model: this.model});
        this.bind('ready', this.map.ready);
        $(this.map.el).bind('openlayersWaxFinished', this.ready);
        $(this.el).append(this.map.el);

        return this;
    },
    ready: function() {
        this.openlayers = $(this.map.el).data('map');
        this.controlZoom({element: this.map.div});
        this.openlayers.events.register('moveend', this.openlayers, this.controlZoom);
        this.controlZoom({element: this.openlayers.div});
        this.openlayers.events.register('zoomend', this.openlayers, this.controlZoom);

        return this;
    },
    controlZoom: function(e) {
        var zoom = this.model.get('minzoom') + this.openlayers.getZoom();
        this.$('.zoom.active').removeClass('active');
        this.$('.zoom-' + zoom).addClass('active');
    }
});

// TilesetListView
// -----------
// View showing each tileset as a thumbnail. Main tileset browsing page.
var TilesetListView = Backbone.View.extend({
    templateName: 'TilesetListView',
    initialize: function(options) {
        _.bindAll(this, 'render');
        this.render().trigger('attach');
    },
    render: function() {
        $(this.el).html(this.template('TilesetListView'));
        var that = this;
        this.collection.each(function(tileset) {
            tileset.view = new TilesetRowView({ model: tileset });
            $('ul.tilesets', that.el).append(tileset.view.el);
        });
        return this;
    }
});

// TilesetRowView
// ----------
// View for a single tileset in a TilesetListView.
var TilesetRowView = Backbone.View.extend({
    tagName: 'li',
    className: 'clearfix',
    initialize: function(options) {
        this.render().trigger('attach');
    },
    render: function() {
        $(this.el).html(this.template('TilesetRowView', this.model.attributes));
        return this;
    },
    attach: function() {
        var zxy = this.model.toZXY();
        if (this.model.get('baselayer')) {
            this.$('span.baselayer-thumb').css({
                'backgroundImage': 'url(' + this.model.get('baselayer').thumb(zxy) + ')'
            });
        }
        this.$('span.thumb').css({
            'backgroundImage': 'url(' + this.model.thumb(zxy) + ')'
        });
    }
});

if (typeof module !== 'undefined') {
    module.exports = {
        PageView: PageView,
        ErrorView: ErrorView,
        TilesetView: TilesetView,
        TilesetListView: TilesetListView,
        TilesetRowView: TilesetRowView
    };
}
