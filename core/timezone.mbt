///|
/// IANA 时区 → UTC 偏移。内核没有时区数据库，但也不能因此"假装"换算成功：
/// 上一版 `offset_hours_for` 只认 5 个标签，`America/Los_Angeles` 被硬编码成 -7
/// （夏令时值，冬天实际是 -8），未知标签则静默按 +0 处理——用户会拿到一个
/// 看起来换算过、其实完全错误的本地时间。
///
/// 现在改成：支持表里明确列出标准偏移 + 夏令时规则，未知标签返回 None，
/// 由调用方显式告知"该时区偏移未知"，不再假装换算成功。

///|
/// 夏令时规则。
pub(all) enum DstRule {
  /// 全年不变（中国大陆 / 香港 / 新加坡 / 印度等）。
  NoDst
  /// 美国：3 月第 2 个周日 02:00 当地标准时起，11 月第 1 个周日 02:00 当地夏令时止
  /// （换算成标准时是 01:00）。
  UsDst
  /// 欧盟：3 月最后一个周日 01:00 UTC 起，10 月最后一个周日 01:00 UTC 止。
  EuDst
} derive(Eq, Debug)

///|
pub extend DstRule with Eq::{equal, not_equal}

///|
pub extend DstRule with Debug::{to_repr}

///|
/// (IANA 标签, 标准偏移分钟数, 夏令时规则)。偏移用分钟而非小时，
/// 因为印度 (+05:30)、尼泊尔 (+05:45) 等不是整小时。
fn zone_rows() -> Array[(String, Int32, DstRule)] {
  [
    ("Asia/Shanghai", 480, NoDst),
    ("Asia/Hong_Kong", 480, NoDst),
    ("Asia/Macau", 480, NoDst),
    ("Asia/Taipei", 480, NoDst),
    ("Asia/Singapore", 480, NoDst),
    ("Asia/Bangkok", 420, NoDst),
    ("Asia/Jakarta", 420, NoDst),
    ("Asia/Kolkata", 330, NoDst),
    ("Asia/Calcutta", 330, NoDst),
    ("Asia/Kathmandu", 345, NoDst),
    ("Asia/Dubai", 240, NoDst),
    ("Asia/Tehran", 210, NoDst),
    ("Asia/Tokyo", 540, NoDst),
    ("Asia/Seoul", 540, NoDst),
    ("Australia/Sydney", 600, NoDst),
    ("Pacific/Auckland", 720, NoDst),
    ("Europe/London", 0, EuDst),
    ("Europe/Dublin", 0, EuDst),
    ("Europe/Lisbon", 0, EuDst),
    ("Europe/Paris", 60, EuDst),
    ("Europe/Berlin", 60, EuDst),
    ("Europe/Madrid", 60, EuDst),
    ("Europe/Rome", 60, EuDst),
    ("Europe/Amsterdam", 60, EuDst),
    ("Europe/Stockholm", 60, EuDst),
    ("Europe/Zurich", 60, EuDst),
    ("Europe/Kyiv", 120, EuDst),
    ("Europe/Kiev", 120, EuDst),
    ("Europe/Jerusalem", 120, EuDst),
    ("Europe/Moscow", 180, NoDst),
    ("America/St_Johns", -210, UsDst),
    ("America/Halifax", -240, UsDst),
    ("America/New_York", -300, UsDst),
    ("America/Toronto", -300, UsDst),
    ("America/Chicago", -360, UsDst),
    ("America/Winnipeg", -360, UsDst),
    ("America/Denver", -420, UsDst),
    ("America/Edmonton", -420, UsDst),
    ("America/Phoenix", -420, NoDst),
    ("America/Los_Angeles", -480, UsDst),
    ("America/Vancouver", -480, UsDst),
    ("America/Anchorage", -540, UsDst),
    ("Pacific/Honolulu", -600, NoDst),
    ("UTC", 0, NoDst),
    ("Etc/UTC", 0, NoDst),
    ("GMT", 0, NoDst),
    ("Etc/GMT", 0, NoDst),
  ]
}

///|
/// 查表：标签 → (标准偏移分钟, 夏令时规则)。未知标签 None。
pub fn zone_rule(zone : String) -> (Int32, DstRule)? {
  for row in zone_rows() {
    let (label, offset, rule) = row
    if label == zone {
      return Some((offset, rule))
    }
  }
  None
}

///|
/// 该时区支持表里是否有这个标签（给 UI 判断"能否换算"用）。
pub fn is_known_zone(zone : String) -> Bool {
  zone_rule(zone) is Some(_)
}

///|
fn epoch_minutes(date : CivilDate, minute_of_day : Int32) -> Int64 {
  date.to_epoch_days() * 1440 + minute_of_day.to_int64()
}

///|
/// 夏令时窗口（UTC 分钟）。边界定义见 `DstRule`。
fn dst_window_utc(
  rule : DstRule,
  year : Int32,
  std_offset : Int32,
) -> (Int64, Int64) {
  match rule {
    NoDst => (0, 0)
    UsDst => {
      let start_day = nth_weekday_of_month(year, 3, 2, 0)
      let end_day = nth_weekday_of_month(year, 11, 1, 0)
      let start_date = CivilDate::new(year, 3, start_day)
      let end_date = CivilDate::new(year, 11, end_day)
      (
        epoch_minutes(start_date, 120) - std_offset.to_int64(),
        epoch_minutes(end_date, 60) - std_offset.to_int64(),
      )
    }
    EuDst => {
      let start_day = last_weekday_of_month(year, 3, 0)
      let end_day = last_weekday_of_month(year, 10, 0)
      let start_date = CivilDate::new(year, 3, start_day)
      let end_date = CivilDate::new(year, 10, end_day)
      (epoch_minutes(start_date, 60), epoch_minutes(end_date, 60))
    }
  }
}

///|
/// 该 UTC 时刻是否处于夏令时。
fn is_dst_at(
  rule : DstRule,
  utc : CivilDate,
  minute_of_day : Int32,
  std_offset : Int32,
) -> Bool {
  match rule {
    NoDst => false
    _ => {
      let (start, end) = dst_window_utc(rule, utc.year, std_offset)
      let t = epoch_minutes(utc, minute_of_day)
      t >= start && t < end
    }
  }
}

///|
/// 给定 IANA 标签与该 UTC 时刻，返回实际偏移（分钟，东为正）。
/// 未知标签 → None：调用方必须显式处理，不能默默按 +0 假装换算成功。
pub fn zone_offset_minutes(
  zone : String,
  utc : CivilDate,
  minute_of_day : Int32,
) -> Int32? {
  match zone_rule(zone) {
    None => None
    Some((std_offset, rule)) => {
      let extra = if is_dst_at(rule, utc, minute_of_day, std_offset) {
        60
      } else {
        0
      }
      Some(std_offset + extra)
    }
  }
}
