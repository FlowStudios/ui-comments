<?php
/**
 * ui-comments PHP endpoint — drop-in for the non-Node sites.
 *
 * Copy next to the page you want commentable, set the two constants (or
 * define them in an included config file), and point the client at it:
 *
 *   <script src="/ui-comments.js" data-auto data-endpoint="/ui-comments.php"></script>
 *
 * Deliberately mbstring-free: the portal's Apache PHP has no mbstring, and an
 * mb_* call there is a fatal that truncates the page.
 */

// --- config -----------------------------------------------------------------
// Prefer defining these in an already-included secrets file so no token
// ever lands in a repo. UI_COMMENTS_REPO is "owner/repo".
if (!defined('UI_COMMENTS_REPO')) {
    define('UI_COMMENTS_REPO', getenv('UI_COMMENTS_REPO') ?: '');
}
if (!defined('UI_COMMENTS_GH_TOKEN')) {
    define('UI_COMMENTS_GH_TOKEN', getenv('UI_COMMENTS_GH_TOKEN') ?: '');
}
if (!defined('UI_COMMENTS_LABEL')) {
    define('UI_COMMENTS_LABEL', 'ui-comment');
}
// Shared secret the client must send as X-UI-Comments-Key. Leave empty ONLY if
// this endpoint already sits behind your admin session check.
if (!defined('UI_COMMENTS_KEY')) {
    define('UI_COMMENTS_KEY', getenv('UI_COMMENTS_KEY') ?: '');
}

header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(array('error' => 'POST only.'));
    exit;
}

function uic_fail($code, $msg)
{
    http_response_code($code);
    echo json_encode(array('error' => $msg));
    exit;
}

function uic_clip($str, $max)
{
    $s = trim(preg_replace('/\s+/', ' ', (string) $str));
    if (strlen($s) > $max) {
        return substr($s, 0, $max) . '...';
    }
    return $s;
}

function uic_row($label, $value)
{
    if ($value === '' || $value === null) {
        return '';
    }
    return '| **' . $label . '** | ' . str_replace('|', '\\|', $value) . " |\n";
}

function uic_github($method, $path, $payload = null)
{
    $ch = curl_init('https://api.github.com' . $path);
    $headers = array(
        'Authorization: Bearer ' . UI_COMMENTS_GH_TOKEN,
        'Accept: application/vnd.github+json',
        'X-GitHub-Api-Version: 2022-11-28',
        'Content-Type: application/json',
        'User-Agent: ui-comments',
    );
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    }
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return array('code' => $code, 'json' => json_decode($body, true));
}

if (UI_COMMENTS_REPO === '' || UI_COMMENTS_GH_TOKEN === '') {
    uic_fail(500, 'ui-comments is not configured (repo/token missing).');
}

// hash_equals over sha256 so neither the value nor its length leaks.
if (UI_COMMENTS_KEY !== '') {
    $sent = isset($_SERVER['HTTP_X_UI_COMMENTS_KEY']) ? $_SERVER['HTTP_X_UI_COMMENTS_KEY'] : '';
    if ($sent === '' || !hash_equals(hash('sha256', UI_COMMENTS_KEY), hash('sha256', $sent))) {
        uic_fail(403, 'Not authorised to file comments.');
    }
}

$raw = file_get_contents('php://input');
$p   = json_decode($raw, true);

if (!is_array($p)) {
    uic_fail(400, 'Invalid JSON.');
}
if (!isset($p['comment']) || trim($p['comment']) === '') {
    uic_fail(400, 'Comment is required.');
}
if (!isset($p['element']['tag'])) {
    uic_fail(400, 'Element details are required.');
}

$el   = isset($p['element']) ? $p['element'] : array();
$page = isset($p['page']) ? $p['page'] : array();
$vp   = isset($p['viewport']) ? $p['viewport'] : array();
$rect = isset($el['rect']) ? $el['rect'] : array();

// Title: first non-empty line of the note, backticks stripped.
$lines = preg_split('/\r?\n/', $p['comment']);
$first = 'UI comment';
foreach ($lines as $line) {
    if (trim($line) !== '') {
        $first = trim(str_replace('`', '', $line));
        break;
    }
}
$title = '[UI] ' . uic_clip($first, 80);

$pagePath = isset($page['path']) ? $page['path'] : (isset($page['url']) ? $page['url'] : '');
$pageUrl  = isset($page['url']) ? $page['url'] : '';

$body  = uic_clip($p['comment'], 4000) . "\n\n---\n\n### Element\n\n";
$body .= "| | |\n|---|---|\n";
$body .= uic_row('Page', $pageUrl ? '[`' . $pagePath . '`](' . $pageUrl . ')' : '');
$body .= uic_row('Tag', isset($el['tag']) ? '`<' . $el['tag'] . '>`' : '');
$body .= uic_row('Id', !empty($el['id']) ? '`' . $el['id'] . '`' : '');
$body .= uic_row('Classes', !empty($el['classes']) ? '`' . $el['classes'] . '`' : '_(none)_');
$body .= uic_row('Text', !empty($el['text']) ? '"' . uic_clip($el['text'], 200) . '"' : '_(none)_');
if (!empty($el['attrs']) && is_array($el['attrs'])) {
    foreach ($el['attrs'] as $k => $v) {
        $body .= uic_row($k, '`' . uic_clip($v, 200) . '`');
    }
}

$notUnique = (isset($el['selectorUnique']) && $el['selectorUnique'] === false);
$body .= "\n**Selector**";
if ($notUnique) {
    $body .= ' - WARNING: matches ' . (int) $el['selectorMatches'] . ' elements, not unique';
}
$body .= "\n\n```css\n" . (isset($el['selector']) ? $el['selector'] : '(none)') . "\n```\n";

if (!empty($el['html'])) {
    $body .= "\n**Rendered HTML**\n\n```html\n" . $el['html'] . "\n```\n";
}

$body .= "\n### Context\n\n| | |\n|---|---|\n";
$body .= uic_row('Title', isset($page['title']) ? $page['title'] : '');
$body .= uic_row('Theme', isset($vp['theme']) ? $vp['theme'] : '');
$body .= uic_row('Viewport', isset($vp['w']) ? $vp['w'] . 'x' . $vp['h'] . ' @' . $vp['dpr'] . 'x' : '');
$body .= uic_row('Element box', isset($rect['w']) ? $rect['w'] . 'x' . $rect['h'] . ' at (' . $rect['x'] . ', ' . $rect['y'] . ')' : '');
$body .= uic_row('Reported', isset($p['meta']['at']) ? $p['meta']['at'] : '');
$body .= uic_row('Project', isset($p['project']) ? $p['project'] : '');

if (!empty($p['context'])) {
    $body .= "\n<details><summary>App context</summary>\n\n```json\n"
        . json_encode($p['context'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        . "\n```\n\n</details>\n";
}

$body .= "\n<sub>Filed from the live page with ui-comments. The class list and selector above are the "
    . "identification handle - grep the source for the text or classes to find the template.</sub>";

// An unknown label 422s the issue create, so make sure it exists first.
$labels = array();
if (UI_COMMENTS_LABEL !== '') {
    $probe = uic_github('GET', '/repos/' . UI_COMMENTS_REPO . '/labels/' . rawurlencode(UI_COMMENTS_LABEL));
    if ($probe['code'] === 404) {
        $probe = uic_github('POST', '/repos/' . UI_COMMENTS_REPO . '/labels', array(
            'name'        => UI_COMMENTS_LABEL,
            'color'       => '7c9cff',
            'description' => 'Filed from a live page with ui-comments',
        ));
    }
    if ($probe['code'] >= 200 && $probe['code'] < 300) {
        $labels[] = UI_COMMENTS_LABEL;
    }
}

$issue = array('title' => $title, 'body' => $body);
if ($labels) {
    $issue['labels'] = $labels;
}

$res = uic_github('POST', '/repos/' . UI_COMMENTS_REPO . '/issues', $issue);

if ($res['code'] < 200 || $res['code'] >= 300) {
    $msg = isset($res['json']['message']) ? $res['json']['message'] : ('GitHub returned ' . $res['code']);
    uic_fail(502, $msg);
}

http_response_code(201);
echo json_encode(array(
    'ok'     => true,
    'number' => $res['json']['number'],
    'url'    => $res['json']['html_url'],
));
