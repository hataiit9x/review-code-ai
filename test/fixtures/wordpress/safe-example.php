<?php

add_action('wp_ajax_save_membership', 'safe_save_membership');

function safe_save_membership(): void
{
    check_ajax_referer('save_membership', 'nonce');

    if (!current_user_can('manage_options')) {
        wp_send_json_error(['message' => 'Forbidden'], 403);
    }

    $memberId = absint($_POST['member_id'] ?? 0);
    $status = sanitize_key(wp_unslash($_POST['status'] ?? ''));
    if ($memberId <= 0 || !in_array($status, ['active', 'paused'], true)) {
        wp_send_json_error(['message' => 'Invalid membership data'], 400);
    }

    global $wpdb;
    $table = $wpdb->prefix . 'memberships';
    $wpdb->update(
        $table,
        ['status' => $status],
        ['id' => $memberId],
        ['%s'],
        ['%d'],
    );
}

add_action('rest_api_init', function (): void {
    register_rest_route('membership/v1', '/status', [
        'methods' => 'GET',
        'callback' => 'safe_membership_status',
        'permission_callback' => static function (): bool {
            return current_user_can('read');
        },
    ]);
});
