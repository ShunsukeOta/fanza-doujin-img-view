<?php

declare(strict_types=1);

if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require dirname(__DIR__).'/bootstrap.php';
$pdo=$database->connection();if(!$pdo){fwrite(STDERR,"DBへ接続できません。\n");exit(1);}
$eventDays=max(7,min(365,(int)($config['app']['event_retention_days']??60)));$profileDays=max($eventDays,min(730,(int)($config['app']['profile_retention_days']??180)));
$deletedEvents=0;$deletedUsers=0;$deletedFeeds=0;
for($i=0;$i<20;$i++){$count=$pdo->exec("DELETE FROM events WHERE created_at<DATE_SUB(NOW(),INTERVAL {$eventDays} DAY) LIMIT 5000");$deletedEvents+=(int)$count;if((int)$count<5000)break;usleep(50000);}
for($i=0;$i<10;$i++){$count=$pdo->exec('DELETE FROM feed_sessions WHERE expires_at<NOW() LIMIT 1000');$deletedFeeds+=(int)$count;if((int)$count<1000)break;}
for($i=0;$i<5;$i++){$count=$pdo->exec("DELETE FROM anonymous_users WHERE last_seen_at<DATE_SUB(NOW(),INTERVAL {$profileDays} DAY) LIMIT 500");$deletedUsers+=(int)$count;if((int)$count<500)break;}
$pdo->exec("DELETE FROM sync_runs WHERE started_at<DATE_SUB(NOW(),INTERVAL 90 DAY) LIMIT 5000");
fwrite(STDOUT,"retention完了 events={$deletedEvents} feeds={$deletedFeeds} users={$deletedUsers}\n");
