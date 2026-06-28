"use client";

export async function scheduleLocalNotification(
  title: string,
  body: string,
  schedule: { at: Date } | { in: number },
  extra?: Record<string, string>
): Promise<string | null> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");

    const id = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scheduleData: any;
    if ("at" in schedule) {
      const notifyTime = new Date(schedule.at);
      if (notifyTime.getTime() <= Date.now()) return null;
      scheduleData = { at: notifyTime };
    } else {
      scheduleData = { at: new Date(Date.now() + schedule.in * 1000) };
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          title,
          body,
          id,
          schedule: scheduleData,
          extra: extra || {},
          sound: "default",
          smallIcon: "ic_stat_icon",
          largeIcon: "ic_launcher_round",
        },
      ],
    });

    return String(id);
  } catch {
    return null;
  }
}

export async function cancelLocalNotification(id: string) {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: parseInt(id) }] });
  } catch {}
}
