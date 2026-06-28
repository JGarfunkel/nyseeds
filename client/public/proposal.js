(function () {
  var bar = document.getElementById('proposal-meta-bar');
  if (!bar) return;

  function meta(name) {
    var el = document.querySelector('meta[name="proposal:' + name + '"]');
    return el ? el.getAttribute('content') : '';
  }

  var status  = meta('status') || 'proposed';
  var date    = meta('date');
  var tags    = meta('tags');

  var label   = status.charAt(0).toUpperCase() + status.slice(1);
  var dateStr = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  var tagStr  = tags
    ? tags.split(',').map(function (t) { return t.trim(); }).join(' · ')
    : '';

  bar.innerHTML =
    '<div class="proposal-meta-bar">' +
    '<span class="pmb-status ' + status + '">' + label + '</span>' +
    (dateStr ? '<span class="pmb-date">'  + dateStr + '</span>' : '') +
    (tagStr  ? '<span class="pmb-tags">'  + tagStr  + '</span>' : '') +
    '</div>';
}());
