namespace VCamNetSampleSourceAOT;

/// <summary>
/// Turns the newest JPEG written by LANCAST into RGB32/NV12 Media Foundation
/// samples. The source deliberately stays on the CPU path: the image crosses
/// process boundaries through Windows Frame Server, so a small, dependable
/// WIC copy is preferable to sharing a renderer-owned D3D texture.
/// </summary>
public class FrameGenerator : IDisposable
{
    private bool _disposed;
    private uint _width;
    private uint _height;
    private ulong _frameCount;
    private long _latestWriteTicks;
    private IComObject<ID2D1RenderTarget>? _renderTarget;
    private IComObject<IMFTransform>? _converter;
    private IComObject<IWICBitmap>? _bitmap;
    private IComObject<ID2D1Bitmap>? _latestFrame;

    public bool HasD3DManager => false;
    public ulong FrameCount => _frameCount;

    private static string FramePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "LANCAST",
        "phone-camera.jpg");

    private void SetConverterTypes(uint width, uint height)
    {
        Functions.MFCreateMediaType(out var inputObj).ThrowOnError();
        using var inputType = new ComObject<IMFMediaType>(inputObj);
        inputType.Set(Constants.MF_MT_MAJOR_TYPE, Constants.MFMediaType_Video);
        inputType.Set(Constants.MF_MT_SUBTYPE, Constants.MFVideoFormat_RGB32);
        inputType.SetSize(Constants.MF_MT_FRAME_SIZE, width, height);
        _converter!.Object.SetInputType(0, inputType.Object, 0).ThrowOnError();

        Functions.MFCreateMediaType(out var outputObj).ThrowOnError();
        using var outputType = new ComObject<IMFMediaType>(outputObj);
        outputType.Set(Constants.MF_MT_MAJOR_TYPE, Constants.MFMediaType_Video);
        outputType.Set(Constants.MF_MT_SUBTYPE, Constants.MFVideoFormat_NV12);
        outputType.SetSize(Constants.MF_MT_FRAME_SIZE, width, height);
        _converter.Object.SetOutputType(0, outputType.Object, 0).ThrowOnError();
    }

    public HRESULT SetD3DManager(nint manager, uint width, uint height) => Constants.S_OK;

    public HRESULT EnsureRenderTarget(uint width, uint height)
    {
        if (_renderTarget != null && _width == width && _height == height) return Constants.S_OK;
        try
        {
            using var factory = D2D1Functions.D2D1CreateFactory(D2D1_FACTORY_TYPE.D2D1_FACTORY_TYPE_MULTI_THREADED);
            _bitmap = WicImagingFactory.CreateBitmap(width, height, Constants.GUID_WICPixelFormat32bppPBGRA, WICBitmapCreateCacheOption.WICBitmapCacheOnDemand);
            _renderTarget = factory.CreateWicBitmapRenderTarget(_bitmap, new D2D1_RENDER_TARGET_PROPERTIES
            {
                pixelFormat = new D2D1_PIXEL_FORMAT
                {
                    alphaMode = D2D1_ALPHA_MODE.D2D1_ALPHA_MODE_PREMULTIPLIED,
                    format = DXGI_FORMAT.DXGI_FORMAT_B8G8R8A8_UNORM
                }
            });
            _converter = DirectN.Extensions.Com.ComObject.CoCreate<IMFTransform>(Constants.CLSID_CColorConvertDMO);
            _width = width;
            _height = height;
            SetConverterTypes(width, height);
            return Constants.S_OK;
        }
        catch (Exception error)
        {
            ComHosting.Trace(error.ToString());
            return error.HResult;
        }
    }

    private void RefreshLatestFrame()
    {
        var path = FramePath;
        if (!File.Exists(path)) return;
        var writeTicks = File.GetLastWriteTimeUtc(path).Ticks;
        if (writeTicks == _latestWriteTicks) return;

        using var decoder = WicImagingFactory.CreateDecoderFromFilename(
            path, null, FileAccess.Read, WICDecodeOptions.WICDecodeMetadataCacheOnLoad);
        using var frame = decoder.GetFrame(0);
        using var scaler = WicImagingFactory.CreateBitmapScaler();
        scaler.Object.Initialize(frame.Object, _width, _height, WICBitmapInterpolationMode.WICBitmapInterpolationModeFant).ThrowOnError();
        using var converter = WicImagingFactory.CreateFormatConverter();
        var pixelFormat = Constants.GUID_WICPixelFormat32bppPBGRA;
        converter.Object.Initialize(
            scaler.Object,
            ref pixelFormat,
            WICBitmapDitherType.WICBitmapDitherTypeNone,
            null!,
            0,
            WICBitmapPaletteType.WICBitmapPaletteTypeCustom).ThrowOnError();
        _renderTarget!.Object.CreateBitmapFromWicBitmap(converter.Object, 0, out var bitmap).ThrowOnError();
        var replacement = new ComObject<ID2D1Bitmap>(bitmap);
        _latestFrame.SafeDispose();
        _latestFrame = replacement;
        _latestWriteTicks = writeTicks;
    }

    public IComObject<IMFSample> Generate(IComObject<IMFSample> sample, Guid format)
    {
        ArgumentNullException.ThrowIfNull(sample);
        try
        {
            try { RefreshLatestFrame(); } catch { /* retain the last complete JPEG */ }
            _renderTarget!.BeginDraw();
            _renderTarget.Clear(new D3DCOLORVALUE(0, 0, 0, 1));
            if (_latestFrame != null)
            {
                _renderTarget.DrawBitmap(
                    _latestFrame,
                    1,
                    D2D1_BITMAP_INTERPOLATION_MODE.D2D1_BITMAP_INTERPOLATION_MODE_LINEAR,
                    new D2D_RECT_F(0, 0, _width, _height),
                    null);
            }
            _renderTarget.EndDraw();

            using var locked = _bitmap!.Lock(WICBitmapLockFlags.WICBitmapLockRead);
            locked.Object.GetDataPointer(out var wicSize, out var wicPointer).ThrowOnError();
            if (format == Constants.MFVideoFormat_NV12)
            {
                Functions.MFCreateSample(out var rgbObj).ThrowOnError();
                using var rgbSample = new ComObject<IMFSample>(rgbObj);
                Functions.MFCreateMemoryBuffer(wicSize, out var bufferObj).ThrowOnError();
                using var rgbBuffer = new ComObject<IMFMediaBuffer>(bufferObj);
                rgbSample.AddBuffer(rgbBuffer);
                rgbBuffer.WithLock((scanline, length, _) => wicPointer.CopyTo(scanline, length));
                rgbBuffer.SetCurrentLength(wicSize);
                _converter!.Object.ProcessInput(0, rgbSample.Object, 0).ThrowOnError();
                DirectN.Extensions.Com.ComObject.WithComInstance(sample, outputPointer =>
                {
                    var buffers = new MFT_OUTPUT_DATA_BUFFER[1];
                    buffers[0].pSample = outputPointer;
                    _converter.Object.ProcessOutput(0, 1, buffers, out _).ThrowOnError();
                });
            }
            else
            {
                using var buffer = sample.GetBufferByIndex(0);
                buffer.WithLock((scanline, length, _) => wicPointer.CopyTo(scanline, length));
                buffer.SetCurrentLength(wicSize);
            }
            _frameCount++;
            return sample;
        }
        catch (Exception error)
        {
            ComHosting.Trace(error.ToString());
            throw;
        }
    }

    protected virtual void Dispose(bool disposing)
    {
        if (_disposed) return;
        if (disposing)
        {
            _latestFrame.SafeDispose();
            _bitmap.SafeDispose();
            _renderTarget.SafeDispose();
            _converter.SafeDispose();
        }
        _disposed = true;
    }

    ~FrameGenerator() { Dispose(false); }
    public void Dispose() { Dispose(true); GC.SuppressFinalize(this); }
}
