var msg = require('../Message');
var SigninCard = (function () {
    function SigninCard(session) {
        this.session = session;
        this.data = {
            contentType: 'application/vnd.microsoft.card.signin',
            content: {}
        };
    }
    SigninCard.prototype.title = function (prompts) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (prompts) {
            this.data.content.title = msg.fmtText(this.session, prompts, args);
        }
        return this;
    };
    SigninCard.prototype.button = function (title, url) {
        if (title && url) {
            this.data.content.button = {
                type: 'signin',
                title: msg.fmtText(this.session, title),
                value: url
            };
        }
        return this;
    };
    SigninCard.prototype.toAttachment = function () {
        return this.data;
    };
    return SigninCard;
})();
exports.SigninCard = SigninCard;
