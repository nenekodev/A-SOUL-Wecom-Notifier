import { formatDistanceToNowStrict } from 'date-fns';

export function timeAgo(timestamp, suffix = true) {
  return formatDistanceToNowStrict(new Date(timestamp), {
    addSuffix: suffix,
  });
}
