var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var dialog = require('./dialogs/Dialog');
var sprintf = require('sprintf-js');
var events = require('events');
var msg = require('./Message');
var Session = (function (_super) {
    __extends(Session, _super);
    function Session(options) {
        _super.call(this);
        this.options = options;
        this.msgSent = false;
        this._isReset = false;
        this.lastSendTime = new Date().getTime();
        this.sendQueue = [];
        this.dialogs = options.dialogs;
        if (typeof this.options.minSendDelay !== 'number') {
            this.options.minSendDelay = 1000;
        }
    }
    Session.prototype.dispatch = function (sessionState, message) {
        var _this = this;
        var index = 0;
        var handlers;
        var session = this;
        var next = function () {
            var handler = index < handlers.length ? handlers[index] : null;
            if (handler) {
                index++;
                handler(session, next);
            }
            else {
                _this.routeMessage();
            }
        };
        this.sessionState = sessionState || { callstack: [], lastAccess: 0 };
        this.sessionState.lastAccess = new Date().getTime();
        this.message = (message || { text: '' });
        if (!this.message.type) {
            this.message.type = 'Message';
        }
        handlers = this.dialogs.getMiddleware();
        next();
        return this;
    };
    Session.prototype.error = function (err) {
        err = err instanceof Error ? err : new Error(err.toString());
        console.error('ERROR: Session Error: ' + err.message);
        this.emit('error', err);
        return this;
    };
    Session.prototype.gettext = function (messageid) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        return this.vgettext(messageid, args);
    };
    Session.prototype.ngettext = function (messageid, messageid_plural, count) {
        var tmpl;
        if (this.options.localizer && this.message) {
            tmpl = this.options.localizer.ngettext(this.message.local || '', messageid, messageid_plural, count);
        }
        else if (count == 1) {
            tmpl = messageid;
        }
        else {
            tmpl = messageid_plural;
        }
        return sprintf.sprintf(tmpl, count);
    };
    Session.prototype.save = function (done) {
        var ss = this.sessionState;
        if (ss.callstack.length > 0) {
            ss.callstack[ss.callstack.length - 1].state = this.dialogData || {};
        }
        this.options.onSave(done);
        return this;
    };
    Session.prototype.send = function (message) {
        var _this = this;
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        this.msgSent = true;
        this.save(function (err) {
            if (!err && message) {
                var m;
                if (typeof message == 'string' || Array.isArray(message)) {
                    m = _this.createMessage(message, args);
                }
                else if (message.toMessage) {
                    m = message.toMessage();
                }
                else {
                    m = message;
                }
                _this.delayedSend(m);
            }
        });
        return this;
    };
    Session.prototype.sendMessage = function (message, done) {
        var _this = this;
        this.msgSent = true;
        this.save(function (err) {
            if (!err && message) {
                var m = message.toMessage ? message.toMessage() : message;
                _this.prepareMessage(m);
                _this.options.onSend([m], done);
            }
            else if (done) {
                done(err);
            }
        });
        return this;
    };
    Session.prototype.messageSent = function () {
        return this.msgSent;
    };
    Session.prototype.beginDialog = function (id, args) {
        var _this = this;
        var dialog = this.dialogs.getDialog(id);
        if (!dialog) {
            throw new Error('Dialog[' + id + '] not found.');
        }
        var ss = this.sessionState;
        if (ss.callstack.length > 0) {
            ss.callstack[ss.callstack.length - 1].state = this.dialogData || {};
        }
        var cur = { id: id, state: {} };
        ss.callstack.push(cur);
        this.dialogData = cur.state;
        this.save(function (err) {
            if (!err) {
                dialog.begin(_this, args);
            }
        });
        return this;
    };
    Session.prototype.replaceDialog = function (id, args) {
        var _this = this;
        var dialog = this.dialogs.getDialog(id);
        if (!dialog) {
            throw new Error('Dialog[' + id + '] not found.');
        }
        var ss = this.sessionState;
        var cur = { id: id, state: {} };
        ss.callstack.pop();
        ss.callstack.push(cur);
        this.dialogData = cur.state;
        this.save(function (err) {
            if (!err) {
                dialog.begin(_this, args);
            }
        });
        return this;
    };
    Session.prototype.endDialog = function (result) {
        var _this = this;
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        var ss = this.sessionState;
        if (!ss || !ss.callstack || ss.callstack.length == 0) {
            console.error('ERROR: Too many calls to session.endDialog().');
            return this;
        }
        var m;
        var r = {};
        if (result) {
            if (typeof result == 'string' || Array.isArray(result)) {
                m = this.createMessage(result, args);
            }
            else if (result.toMessage) {
                m = result.toMessage();
            }
            else if (result.hasOwnProperty('resumed') || result.hasOwnProperty('error') || result.hasOwnProperty('response')) {
                r = result;
            }
            else {
                m = result;
            }
        }
        if (!r.hasOwnProperty('resumed')) {
            r.resumed = dialog.ResumeReason.completed;
        }
        r.childId = ss.callstack[ss.callstack.length - 1].id;
        if (m) {
            this.msgSent = true;
        }
        ss.callstack.pop();
        this.dialogData = null;
        var cur = ss.callstack.length > 0 ? ss.callstack[ss.callstack.length - 1] : null;
        if (cur) {
            this.dialogData = cur.state;
        }
        this.save(function (err) {
            if (!err) {
                if (m) {
                    _this.delayedSend(m);
                }
                if (cur) {
                    var d = _this.dialogs.getDialog(cur.id);
                    if (d) {
                        d.dialogResumed(_this, r);
                    }
                    else {
                        console.error("ERROR: Can't resume missing parent dialog '" + cur.id + "'.");
                        _this.endDialog(r);
                    }
                }
            }
        });
        return this;
    };
    Session.prototype.compareConfidence = function (language, utterance, score, callback) {
        var comparer = new SessionConfidenceComparor(this, language, utterance, score, callback);
        comparer.next();
    };
    Session.prototype.reset = function (dialogId, dialogArgs) {
        this._isReset = true;
        this.sessionState.callstack = [];
        if (!dialogId) {
            dialogId = this.options.dialogId;
            dialogArgs = this.options.dialogArgs;
        }
        this.beginDialog(dialogId, dialogArgs);
        return this;
    };
    Session.prototype.isReset = function () {
        return this._isReset;
    };
    Session.prototype.createMessage = function (text, args) {
        args.unshift(text);
        var message = new msg.Message(this);
        msg.Message.prototype.text.apply(message, args);
        return message.toMessage();
    };
    Session.prototype.prepareMessage = function (msg) {
        if (!msg.type) {
            msg.type = 'message';
        }
        if (!msg.address) {
            msg.address = this.message.address;
        }
        if (!msg.local && this.message.local) {
            msg.local = this.message.local;
        }
    };
    Session.prototype.routeMessage = function () {
        try {
            var ss = this.sessionState;
            if (ss.callstack.length == 0) {
                this.beginDialog(this.options.dialogId, this.options.dialogArgs);
            }
            else if (this.validateCallstack()) {
                var cur = ss.callstack[ss.callstack.length - 1];
                var dialog = this.dialogs.getDialog(cur.id);
                this.dialogData = cur.state;
                dialog.replyReceived(this);
            }
            else {
                console.warn('Callstack is invalid, resetting session.');
                this.reset(this.options.dialogId, this.options.dialogArgs);
            }
        }
        catch (e) {
            this.error(e);
        }
    };
    Session.prototype.vgettext = function (messageid, args) {
        var tmpl;
        if (this.options.localizer && this.message) {
            tmpl = this.options.localizer.gettext(this.message.local || '', messageid);
        }
        else {
            tmpl = messageid;
        }
        return args && args.length > 0 ? sprintf.vsprintf(tmpl, args) : tmpl;
    };
    Session.prototype.validateCallstack = function () {
        var ss = this.sessionState;
        for (var i = 0; i < ss.callstack.length; i++) {
            var id = ss.callstack[i].id;
            if (!this.dialogs.hasDialog(id)) {
                return false;
            }
        }
        return true;
    };
    Session.prototype.delayedSend = function (message) {
        var _that = this;
        function send() {
            var _this = this;
            var now = new Date().getTime();
            var sinceLastSend = now - _that.lastSendTime;
            if (_that.options.minSendDelay && sinceLastSend < _that.options.minSendDelay) {
                setTimeout(function () {
                    send();
                }, _that.options.minSendDelay - sinceLastSend);
            }
            else {
                _that.lastSendTime = now;
                var m = _that.sendQueue.shift();
                _that.prepareMessage(m);
                _that.options.onSend([m], function (err) {
                    if (_this.sendQueue.length > 0) {
                        send();
                    }
                });
            }
        }
        this.sendQueue.push(message);
        send();
    };
    Session.prototype.getMessageReceived = function () {
        console.warn("Session.getMessageReceived() is deprecated. Use Session.message.channelData instead.");
        return this.message.channelData;
    };
    return Session;
})(events.EventEmitter);
exports.Session = Session;
var SessionConfidenceComparor = (function () {
    function SessionConfidenceComparor(session, language, utterance, score, callback) {
        this.session = session;
        this.language = language;
        this.utterance = utterance;
        this.score = score;
        this.callback = callback;
        this.index = session.sessionState.callstack.length - 1;
        this.userData = session.userData;
    }
    SessionConfidenceComparor.prototype.next = function () {
        this.index--;
        if (this.index >= 0) {
            this.getDialog().compareConfidence(this, this.language, this.utterance, this.score);
        }
        else {
            this.callback(false);
        }
    };
    SessionConfidenceComparor.prototype.endDialog = function (result) {
        this.session.sessionState.callstack.splice(this.index + 1);
        this.getDialog().dialogResumed(this.session, result || { resumed: dialog.ResumeReason.childEnded });
        this.callback(true);
    };
    SessionConfidenceComparor.prototype.send = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        args.splice(0, 0, [message]);
        Session.prototype.send.apply(this.session, args);
        this.callback(true);
    };
    SessionConfidenceComparor.prototype.getDialog = function () {
        var cur = this.session.sessionState.callstack[this.index];
        this.dialogData = cur.state;
        return this.session.dialogs.getDialog(cur.id);
    };
    return SessionConfidenceComparor;
})();
