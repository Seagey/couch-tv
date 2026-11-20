import dev.couchtv.ontv.matter.DiscoveryDns;
import dev.couchtv.ontv.matter.DiscoveryMdns;
import dev.couchtv.ontv.matter.DiscoveryModel;
import java.io.BufferedReader;
import java.io.FileReader;
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.List;

/**
 * On-device check of the discovery socket code (run with app_process on an emulator, no app needed).
 * A fake responder on 5353 replays packets captured from real Matter devices: unicast to the asker
 * (one-shot) and multicast to the group. Then DiscoveryMdns.run must find the devices.
 * Usage: DevCheck <fixture file> [<fixture file> ...]
 */
public class DevCheck {
    public static void main(String[] args) throws Exception {
        List<byte[]> replies = new ArrayList<>();
        for (String f : args) {
            try (BufferedReader r = new BufferedReader(new FileReader(f))) {
                String line;
                while ((line = r.readLine()) != null) {
                    String[] p = line.trim().split(" ");
                    if (p.length < 3) continue;
                    String h = p[2];
                    byte[] b = new byte[h.length() / 2];
                    for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
                    replies.add(b);
                }
            }
        }
        List<NetworkInterface> ifs = DiscoveryMdns.Companion.usableInterfaces();
        StringBuilder names = new StringBuilder();
        for (NetworkInterface n : ifs) names.append(n.getName()).append(' ');
        System.out.println("sdk interfaces: " + names);
        // The fake responder.
        MulticastSocket resp = new MulticastSocket(null);
        resp.setReuseAddress(true);
        resp.bind(new InetSocketAddress(5353));
        resp.setSoTimeout(200);
        InetAddress g4 = InetAddress.getByName("224.0.0.251");
        for (NetworkInterface n : ifs) {
            try { resp.joinGroup(new InetSocketAddress(g4, 5353), n); } catch (Exception e) { System.out.println("join4 " + n.getName() + ": " + e); }
            try { resp.joinGroup(new InetSocketAddress(DiscoveryMdns.Companion.group6(n), 5353), n); } catch (Exception e) { System.out.println("join6 " + n.getName() + ": " + e); }
        }
        final int[] answered = {0, 0};
        Thread t = new Thread(() -> {
            byte[] buf = new byte[9000];
            long end = System.currentTimeMillis() + 5000;
            while (System.currentTimeMillis() < end) {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try { resp.receive(p); } catch (Exception e) { continue; }
                if ((buf[2] & 0x80) != 0) continue;                // a response, not a query
                for (byte[] r : replies) {
                    try {
                        if (p.getPort() != 5353) { resp.send(new DatagramPacket(r, r.length, p.getAddress(), p.getPort())); answered[0]++; }
                        else { resp.send(new DatagramPacket(r, r.length, g4, 5353)); answered[1]++; }
                    } catch (Exception e) { System.out.println("send: " + e); }
                }
            }
        });
        t.setDaemon(true);
        t.start();
        DiscoveryModel.Collector c = new DiscoveryModel.Collector();
        DiscoveryMdns.Stats s = new DiscoveryMdns(DiscoveryMdns.Companion::usableInterfaces, msg -> { System.out.println(msg); return kotlin.Unit.INSTANCE; })
            .run(questions(), c, 3500, null);
        resp.close();
        System.out.println("stats: " + s);
        System.out.println("responder: unicast replies " + answered[0] + ", multicast replies " + answered[1]);
        for (DiscoveryModel.Node n : c.nodes())
            System.out.println("node: " + n.getKind() + " " + n.getInstance() + " D=" + n.getDiscriminator() + " port=" + n.getPort() + " v4=" + n.getIpv4() + " v6=" + n.getIpv6());
        for (DiscoveryModel.BorderRouter b : c.borderRouters())
            System.out.println("border router: " + b.getLabel() + " prefix=" + b.getThreadPrefix());
        System.out.println("RESULT nodes=" + c.nodes().size() + " routers=" + c.borderRouters().size() + " listenedOn5353=" + s.getListenedOn5353());
    }

    static List<kotlin.Pair<DiscoveryDns.DnsName, Integer>> questions() {
        List<kotlin.Pair<DiscoveryDns.DnsName, Integer>> q = new ArrayList<>();
        for (DiscoveryDns.DnsName n : DiscoveryModel.INSTANCE.getALL_TYPES()) q.add(new kotlin.Pair<>(n, DiscoveryDns.TYPE_PTR));
        return q;
    }
}
