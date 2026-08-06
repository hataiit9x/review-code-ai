<?php

add_action('wp_ajax_nopriv_update_membership', 'unsafe_update_membership');

function unsafe_update_membership(): void
{
    global $wpdb;
    $memberId = $_POST['member_id'] ?? '';
    $status = $_POST['status'] ?? '';
    $wpdb->query("UPDATE {$wpdb->prefix}memberships SET status = '$status' WHERE id = $memberId");
    update_user_meta((int) $memberId, 'paid', true);
}

add_action('rest_api_init', function (): void {
    register_rest_route('membership/v1', '/status', [
        'methods' => 'POST',
        'callback' => 'unsafe_membership_status',
        'permission_callback' => '__return_true',
    ]);
});

add_action('admin_post_process_upload', 'unsafe_upload');

function unsafe_upload(): void
{
    move_uploaded_file($_FILES['upload']['tmp_name'], ABSPATH . $_FILES['upload']['name']);
}
