namespace VCamNetSampleAOT;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length != 1 || !string.Equals(args[0], "--start", StringComparison.OrdinalIgnoreCase))
        {
            Console.Error.WriteLine("Usage: LANCAST.VirtualCamera.exe --start");
            return 2;
        }

        ComObject<IMFVirtualCamera>? camera = null;
        try
        {
            Functions.MFStartup(Constants.MF_VERSION, 0).ThrowOnError();
            var hr = Functions.MFCreateVirtualCamera(
                MFVirtualCameraType.MFVirtualCameraType_SoftwareCameraSource,
                MFVirtualCameraLifetime.MFVirtualCameraLifetime_Session,
                MFVirtualCameraAccess.MFVirtualCameraAccess_CurrentUser,
                PWSTR.From("LANCAST Phone Camera"),
                PWSTR.From($"{{{Shared.CLSID_VCamNetAOT}}}"),
                0,
                0,
                out var instance);
            hr.ThrowOnError();
            camera = new ComObject<IMFVirtualCamera>(instance);
            camera.Object.Start(null).ThrowOnError();

            Console.WriteLine("READY");
            Console.Out.Flush();
            while (Console.ReadLine() is string command)
            {
                if (string.Equals(command.Trim(), "stop", StringComparison.OrdinalIgnoreCase)) break;
            }
            camera.Object.Remove();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            Console.Error.Flush();
            return error.HResult != 0 ? error.HResult : 1;
        }
        finally
        {
            camera?.Dispose();
            Functions.MFShutdown();
        }
    }
}
