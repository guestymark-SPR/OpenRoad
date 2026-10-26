import uk.openroad.app.GroupLink;
import java.util.*;
import java.util.concurrent.*;

/** Checks the group link end to end: two riders in a group see each other, a rider with another code sees nothing,
    a rider joining later gets the kept position, and leaving clears it. Usage: GroupTest server [server...] */
public class GroupTest {
    static final Map<String, List<String>> got = new ConcurrentHashMap<>();
    static GroupLink.Listener L(String who) {
        return new GroupLink.Listener() {
            public void onMessage(String kind, String json) { got.computeIfAbsent(who, k -> new CopyOnWriteArrayList<>()).add(kind + " " + json); }
            public void onStatus(String s, String st) { System.out.println(who + " @" + s + ": " + st); }
        };
    }
    static boolean has(String who, String needle) { for (String s : got.getOrDefault(who, List.of())) if (s.contains(needle)) return true; return false; }
    static void waitFor(String who, String needle, int sec) throws Exception { for (int i = 0; i < sec * 10 && !has(who, needle); i++) Thread.sleep(100); }
    public static void main(String[] a) throws Exception {
        String code = GroupLink.newCode(); System.out.println("code " + code);
        int fails = 0;
        for (String server : a) {
            got.clear();
            String[] one = {server};
            GroupLink mark = new GroupLink(code, "aaaaaa000001", one, L("mark"));
            GroupLink dave = new GroupLink(code.toLowerCase().replace("-", " "), "bbbbbb000002", one, L("dave"));
            GroupLink other = new GroupLink(GroupLink.newCode(), "cccccc000003", one, L("other"));
            Thread.sleep(4000);
            mark.sendPosition("{\"id\":\"aaaaaa000001\",\"n\":\"Mark\",\"la\":52.45,\"lo\":-1.78}");
            dave.sendMessage("{\"id\":\"bbbbbb000002\",\"n\":\"Dave\",\"k\":\"fuel\"}");
            waitFor("dave", "Mark", 10); waitFor("mark", "fuel", 10); Thread.sleep(1500);
            GroupLink late = new GroupLink(code, "dddddd000004", one, L("late"));
            waitFor("late", "Mark", 12);
            boolean ok1 = has("dave", "p {\"id\":\"aaaaaa000001\",\"n\":\"Mark\""), ok2 = has("mark", "m {\"id\":\"bbbbbb000002\""), ok3 = !got.containsKey("other"), ok4 = has("late", "Mark");
            mark.close(); waitFor("dave", "left {\"id\":\"aaaaaa000001\"}", 10);
            boolean ok5 = has("dave", "left {\"id\":\"aaaaaa000001\"}");
            System.out.println(server + ": dave sees Mark " + ok1 + " | Mark hears Dave " + ok2 + " | other group sees nothing " + ok3 + " | late joiner gets kept position " + ok4 + " | leaving clears it " + ok5);
            if (!(ok1 && ok2 && ok3 && ok4 && ok5)) fails++;
            dave.close(); other.close(); late.close(); Thread.sleep(1500);
        }
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " SERVER(S) FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
