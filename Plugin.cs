using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Jellyfin.Plugin.MusicVisualizer;

public class Plugin : BasePlugin<BasePluginConfiguration>
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
    }

    public override string Name => "Music Visualizer";

    public override Guid Id => Guid.Parse("a18f3d21-6c40-4e9a-8b12-91d0e4f7a101");

    public override string Description => "Interactive fullscreen audio visualizer (Frequency Bars, Waveform, Circular Bars, 3D Rotating Spectrum, 3D Starfield, Rainbow Road) with dynamic synchronized lyrics and artist backdrop slideshow.";
}

public class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddTransient<IStartupFilter, VisualizerStartupFilter>();
    }
}

public sealed class VisualizerStartupFilter : IStartupFilter
{
    private const string ScriptRoute = "/web/plugins/musicvisualizer.js";
    private const string PluginWindowKey = "musicVisualizerPlugin";
    private const string ResourceName = "Jellyfin.Plugin.MusicVisualizer.Web.visualizer.js";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                var path = context.Request.Path.Value ?? string.Empty;

                if (path.EndsWith(ScriptRoute, StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.ContentType = "application/javascript; charset=utf-8";
                    context.Response.Headers.CacheControl = "no-cache";
                    await using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName);
                    if (stream is not null)
                    {
                        await stream.CopyToAsync(context.Response.Body).ConfigureAwait(false);
                    }
                    return;
                }

                bool isIndexHtml = path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
                    || path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase);
                bool isConfigJson = path.EndsWith("/web/config.json", StringComparison.OrdinalIgnoreCase);

                if (!isIndexHtml && !isConfigJson)
                {
                    await nextMiddleware().ConfigureAwait(false);
                    return;
                }

                // Prevent gzip compression on index.html and config.json so we can transform the text
                context.Request.Headers.Remove("Accept-Encoding");
                var originalBody = context.Response.Body;
                using var memStream = new MemoryStream();
                context.Response.Body = memStream;

                await nextMiddleware().ConfigureAwait(false);

                memStream.Position = 0;
                var content = await new StreamReader(memStream, Encoding.UTF8).ReadToEndAsync().ConfigureAwait(false);

                if (context.Response.StatusCode == 200 && !string.IsNullOrEmpty(content))
                {
                    if (isIndexHtml && content.Contains("</body>", StringComparison.OrdinalIgnoreCase))
                    {
                        var scriptTag = $"<script src=\"plugins/musicvisualizer.js\"></script></body>";
                        content = content.Replace("</body>", scriptTag, StringComparison.OrdinalIgnoreCase);
                    }
                    else if (isConfigJson)
                    {
                        try
                        {
                            var node = JsonNode.Parse(content);
                            if (node?["plugins"] is JsonArray pluginsArray &&
                                !pluginsArray.Any(p => p?.GetValue<string>() == PluginWindowKey))
                            {
                                pluginsArray.Add(PluginWindowKey);
                                content = node.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
                            }
                        }
                        catch
                        {
                        }
                    }
                }

                var bytes = Encoding.UTF8.GetBytes(content);
                context.Response.ContentLength = bytes.Length;
                context.Response.Body = originalBody;
                await originalBody.WriteAsync(bytes).ConfigureAwait(false);
            });

            next(app);
        };
    }
}

